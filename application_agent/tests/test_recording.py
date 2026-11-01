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
 def test_failed_media_upload_never_replays_application_or_changes_result(self):
  from types import SimpleNamespace
  calls=[];task={'requestId':'fixture','claimId':'claim'}
  def call(site,token,path,data=None,**kwargs):
   calls.append((path,data))
   if path.endswith('/claim'):return {'task':task}
   if '/cv?' in path:return b'fictional CV'
   return {}
  watch=SimpleNamespace(recording_info={'duration':2,'partial':False},close=lambda:None,cleanup_recording=lambda:None)
  with patch('application_agent.runner.call_site',side_effect=call),patch('application_agent.live_watch.LiveWatch',return_value=watch),patch('application_agent.runner.execute_application',return_value={'status':'needs_attention','message':'Fixture only'} ) as execute,patch('application_agent.runner.upload_recording',side_effect=OSError('offline')) as upload,patch('application_agent.login_sessions.LoginSessions'):
   self.assertTrue(run_once('https://site.example','ca2.owner.secret'));self.assertEqual(execute.call_count,1);self.assertEqual(upload.call_count,2)
  results=[body for path,body in calls if path.endswith('/result')];self.assertEqual(len(results),1);self.assertEqual(results[0]['status'],'needs_attention')
