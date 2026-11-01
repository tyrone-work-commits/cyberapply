import base64,threading,time,unittest
from application_agent.live_watch import LiveWatch
from application_agent.tests.test_video_encoder import jpeg

class Session:
 def __init__(self):self.sent=[];self.handler=None
 def on(self,name,handler):self.handler=handler
 def send(self,name,data=None):
  self.sent.append((name,data))
  return {'data':base64.b64encode(jpeg()).decode()} if name=='Page.captureScreenshot' else {}
 def detach(self):self.sent.append(('detach',None))
class WatchTests(unittest.TestCase):
 def test_private_viewer_receives_encoded_video_and_stop_without_page_controls(self):
  calls=[];received=threading.Event()
  def call(body):
   calls.append(body)
   if body.get('video',{}).get('kind')=='segment':received.set()
   return {'watching':True}
  watch=LiveWatch(call,'request','claim',interval=.01)
  try:
   self.assertTrue(watch.watching.wait(1));session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object())
   session.handler({'sessionId':1,'data':base64.b64encode(jpeg()).decode()})
   self.assertTrue(received.wait(5));self.assertIn(('Page.screencastFrameAck',{'sessionId':1}),session.sent)
   videos=[c['video'] for c in calls if c.get('video')];self.assertEqual(videos[0]['kind'],'init');self.assertEqual(base64.b64decode(videos[1]['data'])[4:8],b'moof')
   watch.detach();self.assertIn(('Page.stopScreencast',None),session.sent)
  finally:watch.close()
  self.assertTrue(calls[-1]['stop']);self.assertTrue(all(c['requestId']=='request' and c['claimId']=='claim' and c.get('protocol')==2 for c in calls))
 def test_no_viewer_never_uploads_video(self):
  calls=[]
  def call(body):calls.append(body);return {'watching':False}
  watch=LiveWatch(call,'request','claim',interval=.01)
  try:
   session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object())
   session.handler({'sessionId':2,'data':base64.b64encode(jpeg()).decode()});time.sleep(.1);self.assertFalse(any('video' in body for body in calls));watch.capture()
  finally:watch.detach();watch.close()
 def test_capture_and_unsupported_browser_are_nonfatal(self):
  watch=LiveWatch(lambda body:{'watching':True},'request','claim',interval=.01)
  try:
   self.assertTrue(watch.watching.wait(1));session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object());watch.capture()
   self.assertTrue(any(name=='Page.captureScreenshot' for name,_ in session.sent));watch.attach(object(),object());self.assertIsNone(watch.session)
  finally:watch.close()
 def test_media_connection_failure_is_nonfatal_and_disables_viewing(self):
  called=threading.Event()
  def fail(body):called.set();raise OSError('Fixture connection lost')
  watch=LiveWatch(fail,'request','claim',interval=.01)
  try:self.assertTrue(called.wait(1));self.assertFalse(watch.watching.is_set());watch.attach(object(),object());watch.capture()
  finally:watch.close()
