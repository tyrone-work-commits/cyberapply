import base64,threading,time,unittest
from application_agent.live_watch import LiveWatch

class Session:
 def __init__(self):self.sent=[];self.handler=None
 def on(self,name,handler):self.handler=handler
 def send(self,name,data=None):
  self.sent.append((name,data))
  return {'data':base64.b64encode(b'\xff\xd8snapshot\xff\xd9').decode()} if name=='Page.captureScreenshot' else {}
 def detach(self):self.sent.append(('detach',None))
class WatchTests(unittest.TestCase):
 def test_private_viewer_receives_frames_and_stop_without_page_controls(self):
  calls=[];received=threading.Event()
  def call(body):
   calls.append(body)
   if body.get('frame'):received.set()
   return {'watching':True}
  watch=LiveWatch(call,'request','claim',interval=.01)
  try:
   self.assertTrue(watch.watching.wait(1));session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object())
   session.handler({'sessionId':1,'data':'/9j/2Q=='})
   self.assertTrue(received.wait(1));self.assertIn(('Page.screencastFrameAck',{'sessionId':1}),session.sent)
   watch.detach();self.assertIn(('Page.stopScreencast',None),session.sent)
  finally:watch.close()
  self.assertTrue(calls[-1]['stop']);self.assertTrue(all(c['requestId']=='request' and c['claimId']=='claim' for c in calls))
 def test_no_viewer_or_network_failure_never_uploads_a_frame(self):
  calls=[]
  def call(body):calls.append(body);return {'watching':False}
  watch=LiveWatch(call,'request','claim',interval=.01)
  try:
   session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object())
   session.handler({'sessionId':2,'data':'private-frame'});time.sleep(.03);self.assertFalse(any('frame' in body for body in calls));watch.capture()
  finally:watch.detach();watch.close()
 def test_snapshot_capture_and_unsupported_browser_are_nonfatal(self):
  watch=LiveWatch(lambda body:{'watching':True},'request','claim',interval=.01)
  try:
   self.assertTrue(watch.watching.wait(1));session=Session();watch.attach(type('Context',(),{'new_cdp_session':lambda _,page:session})(),object());watch.capture()
   self.assertTrue(any(name=='Page.captureScreenshot' for name,_ in session.sent));watch.attach(object(),object());self.assertIsNone(watch.session)
  finally:watch.close()
