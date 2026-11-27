"""No employer traffic: held synthetic tasks prove actual concurrent execution."""
import threading
import time
import unittest
from unittest.mock import patch
from application_agent.parallel_runner import run_pool


class ParallelRunnerTests(unittest.TestCase):
 def test_all_ten_start_before_any_finishes_and_stop_drains_without_cancelling(self):
  started=threading.Barrier(11);release=threading.Event();stop=threading.Event();finished=[];reports=[]
  lock=threading.Lock();next_id=[0]
  def work(state):
   with lock:key=next_id[0];next_id[0]+=1
   state('working');started.wait(timeout=10);release.wait(10)
   with lock:finished.append(key)
   return True
  worker=threading.Thread(target=lambda:run_pool(work,stop.is_set,lambda s,**r:reports.append((s,r)),interval=.01,wait=lambda _:time.sleep(.005)))
  worker.start();started.wait(timeout=10);stop.set();time.sleep(.03)
  self.assertTrue(worker.is_alive());self.assertEqual(finished,[])
  self.assertTrue(any(s=='working' and r['activeApplications']==10 for s,r in reports))
  release.set();worker.join(10);self.assertFalse(worker.is_alive());self.assertEqual(sorted(finished),list(range(10)))
  self.assertEqual(reports[-1][0],'stopped');self.assertTrue(reports[-1][1]['draining'])

 def test_a_failed_job_does_not_cancel_or_replay_the_other_job(self):
  failed=threading.Event();held=threading.Event();release=threading.Event();stop=threading.Event();calls=[];lock=threading.Lock()
  def work(state):
   with lock:key=len(calls);calls.append(key)
   state('working')
   if key==0:failed.set();raise OSError('Synthetic offline result; never repeat a form')
   held.set();release.wait(10);return True
  reports=[];worker=threading.Thread(target=lambda:run_pool(work,stop.is_set,lambda s,**r:reports.append((s,r)),limit=2,wait=lambda _:time.sleep(.005)))
  worker.start();self.assertTrue(failed.wait(10));self.assertTrue(held.wait(10));stop.set();time.sleep(.03)
  self.assertTrue(worker.is_alive());release.set();worker.join(10);self.assertFalse(worker.is_alive());self.assertEqual(calls,[0,1])

 def test_finished_slot_is_reused_while_other_exact_session_is_held(self):
  held=threading.Event();release=threading.Event();third=threading.Event();stop=threading.Event();lock=threading.Lock();calls=[]
  def work(state):
   with lock:key=len(calls);calls.append(key)
   state('working')
   if key==0:held.set();release.wait(10)
   elif key==1:self.assertTrue(held.wait(10))
   else:third.set();stop.set()
   return True
  worker=threading.Thread(target=lambda:run_pool(work,stop.is_set,lambda *a,**kw:None,limit=2,interval=.01,wait=lambda _:time.sleep(.005)))
  worker.start();self.assertTrue(third.wait(10));self.assertTrue(worker.is_alive());release.set();worker.join(10)
  self.assertFalse(worker.is_alive());self.assertEqual(calls,[0,1,2])

 def test_idle_jobs_back_off_and_maintenance_only_runs_without_active_forms(self):
  now=[0];stop=threading.Event();calls=[];maintenance=[]
  def work(state):calls.append(now[0]);return False
  def wait(_):
   time.sleep(.005);now[0]+=.1
   if now[0]>1:stop.set()
  run_pool(work,stop.is_set,lambda *a,**kw:None,limit=2,maintenance=lambda:maintenance.append(now[0]),wait=wait,clock=lambda:now[0])
  self.assertEqual(len(calls),2);self.assertEqual(len(maintenance),1)

 def test_bad_local_status_reader_does_not_interrupt_held_forms(self):
  stop=threading.Event();calls=[]
  def work(state):state('working');calls.append(1);stop.set();return True
  def publish(*args,**kwargs):raise OSError('Synthetic reader lock')
  run_pool(work,stop.is_set,publish,limit=1,wait=lambda _:time.sleep(.005));self.assertEqual(calls,[1])

 def test_limits_are_bounded_and_legacy_companion_reserves_one_slot(self):
  for value in (0,11,-1):
   with self.assertRaises(ValueError):run_pool(lambda _:False,lambda:True,lambda *a,**kw:None,limit=value)
  reports=[];run_pool(lambda _:False,lambda:True,lambda s,**r:reports.append(r),limit=9)
  self.assertEqual(reports[-1]['parallelSlots'],9)

 def test_parallel_claim_advertises_capability_and_skips_idle_maintenance(self):
  from application_agent.runner import run_once
  with patch('application_agent.runner.call_site',return_value={'task':None}) as call,patch('application_agent.location_choices.run_location_capture') as capture,patch('application_agent.runner.maybe_refresh_sources') as refresh,patch('application_agent.recording_delivery.flush_pending'):
   self.assertFalse(run_once('https://app.example','fixture',parallel=True))
   self.assertEqual(call.call_args.args[3]['parallelApplicationsVersion'],1);capture.assert_not_called();refresh.assert_not_called()

 def test_concurrent_workspace_writes_are_serialized_without_repeating_http_calls(self):
  from application_agent.runner import call_site
  count=[0];peak=[0];calls=[];lock=threading.Lock()
  class Response:
   def __enter__(self):
    with lock:count[0]+=1;peak[0]=max(peak[0],count[0])
    time.sleep(.02);return self
   def read(self,limit):return b'{"recorded":true}'
   def __exit__(self,*args):
    with lock:count[0]-=1
  class Opener:
   def open(self,req,timeout):calls.append(req.full_url);return Response()
  with patch('urllib.request.build_opener',return_value=Opener()):
   threads=[threading.Thread(target=lambda:call_site('https://app.example','fixture','/api/application-agent/result',{'fixture':True})) for _ in range(10)]
   for t in threads:t.start()
   for t in threads:t.join(10);self.assertFalse(t.is_alive())
  self.assertEqual(peak[0],1);self.assertEqual(len(calls),10)
