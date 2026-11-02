import unittest,json
from unittest.mock import patch
from application_agent.runner import deliver_questions

class QuestionDeliveryTests(unittest.TestCase):
 def test_large_catalog_batches_retry_metadata_only_and_exclude_credentials(self):
  questions=[{'question':f'Optional question {i} '+('x'*3000),'field_type':'text'} for i in range(80)]
  report={'questions':questions+[{'question':'Password','field_type':'password'}],'answers':[{'question':questions[-1]['question'],'value':'CV grounded answer','source':'cv','evidence':'Dated CV history'}]}
  calls=[]
  def call(site,token,path,data,**kwargs):
   calls.append((path,data));self.assertLess(len(json.dumps(data)),65000);self.assertLessEqual(kwargs['timeout'],4)
   if len(calls)==1:raise TimeoutError()
   return {'saved':len(data['questions']),'omitted':0}
  with patch('application_agent.runner.call_site',side_effect=call):result=deliver_questions('https://site.example','private',{'requestId':'one','claimId':'claim'},report)
  self.assertEqual(result,{'saved':80,'omitted':0,'deliveryFailed':0})
  self.assertTrue(all(path=='/api/application-agent/questions' for path,_ in calls))
  self.assertEqual(calls[-1][1]['questions'][-1]['value'],'CV grounded answer')
 def test_failed_metadata_delivery_is_bounded_and_does_not_retry_a_submission(self):
  with patch('application_agent.runner.call_site',side_effect=TimeoutError()) as call:
   result=deliver_questions('https://site.example','private',{'requestId':'one','claimId':'claim'},{'questions':[{'question':'City','field_type':'text'}]})
  self.assertEqual(call.call_count,2);self.assertEqual(result['deliveryFailed'],1)

 def test_oversized_report_delivers_questions_before_one_outcome_post(self):
  from application_agent.runner import run_once
  paths=[]
  def call(site,token,path,data=None,**kwargs):
   paths.append(path)
   if path.endswith('/claim'):return {'task':{'requestId':'one','claimId':'claim'}}
   if path.startswith('/api/application-agent/cv?'):return b'fixture cv'
   if path.endswith('/questions'):return {'saved':1,'omitted':0}
   return {'recorded':True}
  result={'status':'needs_attention','message':'Fixture only','report':{'large_diagnostic':'x'*56000,'questions':[{'question':'Optional question?','field_type':'text'}]}}
  with patch('application_agent.runner.call_site',side_effect=call),patch('application_agent.runner.execute_application',return_value=result),patch('application_agent.recording_delivery.RecordingDelivery'),patch('application_agent.recording_delivery.flush_pending'),patch('application_agent.live_watch.LiveWatch',side_effect=OSError()),patch('application_agent.login_sessions.LoginSessions'):
   self.assertTrue(run_once('https://site.example','ca2.owner.private'))
  self.assertEqual(paths.count('/api/application-agent/result'),1)
  self.assertLess(paths.index('/api/application-agent/questions'),paths.index('/api/application-agent/result'))
  self.assertEqual(result['report']['questionDelivery']['saved'],1)

 def test_expired_claim_skips_question_bookkeeping_to_preserve_outcome_delivery(self):
  with patch('application_agent.runner.call_site') as call:
   result=deliver_questions('https://site.example','private',{'requestId':'one','claimId':'claim','expiresAt':'2000-01-01T00:00:00Z'},{'questions':[{'question':'City','field_type':'text'}]})
  call.assert_not_called();self.assertEqual(result['deliveryFailed'],1)
