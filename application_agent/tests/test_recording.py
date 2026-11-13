import base64,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import av
from application_agent.recording import ApplicationRecording
from application_agent.video_encoder import RecordingEncoder
from application_agent.live_watch import LiveWatch
from application_agent.tests.test_live_watch import Session
from application_agent.tests.test_video_encoder import jpeg
from application_agent.runner import run_once

class RecordingTests(unittest.TestCase):
 def test_finalized_mp4_is_seekable_h264(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'run.mp4';encoder=RecordingEncoder(path)
   for i in range(24):encoder.add(jpeg(30+i*5))
   encoder.close();raw=path.read_bytes();self.assertLess(raw.index(b'moov'),raw.index(b'mdat'))
   with av.open(str(path)) as movie:
    self.assertEqual(len(list(movie.decode(video=0))),24);self.assertEqual(movie.duration,3_000_000)
    movie.seek(1_000_000);self.assertGreater(len(list(movie.decode(video=0))),0)
 def test_records_without_live_viewer_and_cleans_temp_file(self):
  calls=[];watch=LiveWatch(lambda body:(calls.append(body) or {'watching':False}),'request','claim',interval=.01,record=True)
  try:
   session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object())
   session.handler({'sessionId':1,'data':base64.b64encode(jpeg()).decode()});time.sleep(.5);watch.finish_capture();watch.close()
   info=watch.recording_info;self.assertIsNotNone(info);self.assertFalse(any('video' in body for body in calls))
   with av.open(str(info['path'])) as movie:self.assertGreaterEqual(len(list(movie.decode(video=0))),2)
   watch.cleanup_recording();self.assertFalse(info['path'].exists())
  finally:watch.close();watch.cleanup_recording()
 def test_recording_limit_is_partial_without_failing_application(self):
  with patch('application_agent.recording.MAX_RECORDING_SECONDS',.125):
   recording=ApplicationRecording();recording.set_active(True);recording.offer(base64.b64encode(jpeg()).decode());time.sleep(.4)
   try:
    info=recording.finish();self.assertIsNotNone(info);self.assertTrue(info['partial']);self.assertEqual(info['reason'],'recording_limit')
   finally:recording.cleanup()
 def test_no_browser_frames_leaves_no_recording(self):
  recording=ApplicationRecording();self.assertIsNone(recording.finish());self.assertIsNone(recording.path)
 def test_checkpoint_is_playable_before_the_run_finishes(self):
  import shutil
  with tempfile.TemporaryDirectory() as directory,patch('application_agent.recording.CHECKPOINT_SECONDS',.25):
   parts=[]
   def keep(info):
    target=Path(directory)/f"part-{len(parts)}.mp4";shutil.move(info['path'],target);parts.append({**info,'path':target})
   recording=ApplicationRecording(on_part=keep);recording.set_active(True);recording.offer(base64.b64encode(jpeg()).decode());time.sleep(.8)
   try:
    self.assertGreaterEqual(len(parts),2);self.assertTrue(recording.thread.is_alive())
    with av.open(str(parts[0]['path'])) as movie:self.assertGreater(len(list(movie.decode(video=0))),0)
   finally:recording.finish();recording.cleanup()
 def test_offline_upload_is_retained_and_recovered_without_applying_again(self):
  import json
  from application_agent.recording_delivery import RecordingDelivery,flush_pending,ACTIVE
  with tempfile.TemporaryDirectory() as directory,patch('application_agent.recording_delivery.outbox',return_value=Path(directory)),patch.object(RecordingDelivery,'_pump'),patch('application_agent.runner.call_site',return_value={}) as call:
   delivery=RecordingDelivery('https://site.example','ca2.owner.secret',{'requestId':'fixture','claimId':'claim'})
   path=Path(directory)/'original.mp4';path.write_bytes(b'private fictional media')
   delivery.part({'path':path,'duration':1,'startedAt':'2026-11-01T00:00:00Z','part':0,'partial':False,'reason':''})
   with patch('application_agent.runner.upload_recording',side_effect=OSError('offline')):delivery.finish()
   entries=list(Path(directory).glob('*.media.json'));self.assertEqual(len(entries),1);self.assertEqual(len(list(Path(directory).glob('*.mp4'))),1)
   entry=entries[0];value=json.loads(entry.read_text());value['nextTry']=0;entry.write_text(json.dumps(value))
   with patch('application_agent.runner.upload_recording',return_value={'saved':True}) as upload:flush_pending('https://site.example','ca2.owner.secret');self.assertEqual(upload.call_count,1)
   self.assertFalse(list(Path(directory).glob('*.mp4')));self.assertFalse(list(Path(directory).glob('*.media.json')))
   self.assertTrue(all(args.args[2]=='/api/application-agent/recording-status' for args in call.call_args_list))
 def test_recording_failure_never_replays_application_or_changes_result(self):
  from types import SimpleNamespace
  calls=[];task={'requestId':'fixture','claimId':'claim'}
  def call(site,token,path,data=None,**kwargs):
   calls.append((path,data))
   if path=='/api/application-agent/location-choices/claim':return {'task':None}
   if path.endswith('/claim'):return {'task':task}
   if '/cv?' in path:return b'fictional CV'
   return {}
  watch=SimpleNamespace(recording_info={'duration':2,'partial':False},recording=None,close=lambda:None,cleanup_recording=lambda:None)
  with patch('application_agent.recording_delivery.RecordingDelivery') as delivery,patch('application_agent.recording_delivery.flush_pending'),patch('application_agent.runner.call_site',side_effect=call),patch('application_agent.live_watch.LiveWatch',return_value=watch),patch('application_agent.runner.execute_application',return_value={'status':'needs_attention','message':'Fixture only'}) as execute,patch('application_agent.login_sessions.LoginSessions'):
   delivery.return_value.finish.side_effect=lambda *_:self.assertTrue(any(path.endswith('/result') for path,_ in calls))
   self.assertTrue(run_once('https://site.example','ca2.owner.secret'));self.assertEqual(execute.call_count,1);self.assertEqual(delivery.return_value.finish.call_count,1)
  results=[body for path,body in calls if path.endswith('/result')];self.assertEqual(len(results),1);self.assertEqual(results[0]['status'],'needs_attention')

 def test_restart_recovers_saved_parts_and_marks_unfinished_capture_interrupted(self):
  from application_agent.recording_delivery import RecordingDelivery,flush_pending,ACTIVE
  with tempfile.TemporaryDirectory() as directory,patch('application_agent.recording_delivery.outbox',return_value=Path(directory)),patch.object(RecordingDelivery,'_pump'),patch('application_agent.runner.call_site',return_value={}) as call,patch('application_agent.runner.upload_recording',return_value={'saved':True}) as upload:
   delivery=RecordingDelivery('https://site.example','ca2.owner.secret',{'requestId':'fixture','claimId':'claim'})
   path=Path(directory)/'original.mp4';path.write_bytes(b'fictional interrupted capture')
   delivery.part({'path':path,'duration':1,'startedAt':'2026-11-01T00:00:00Z','part':0,'partial':False,'reason':''})
   ACTIVE.discard(str(delivery.path));delivery.stop.set()  # Simulates restarted worker memory, not a normal finish.
   flush_pending('https://site.example','ca2.owner.secret')
   self.assertEqual(upload.call_count,1);self.assertEqual(call.call_args.args[3]['state'],'interrupted');self.assertTrue(call.call_args.args[3]['partial'])
 def test_media_paths_and_owners_cannot_cross_local_namespaces(self):
  import os
  from application_agent.recording_delivery import outbox,media_path
  with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'LOCALAPPDATA':directory}):
   a=outbox('https://site.example','ca2.ownerA.secret');b=outbox('https://site.example','ca2.ownerB.secret');self.assertNotEqual(a,b)
   for name in ['../private.mp4','a'*32+'.mp4/..','C:/private.mp4']:
    with self.assertRaises(ValueError):media_path(a,name)
