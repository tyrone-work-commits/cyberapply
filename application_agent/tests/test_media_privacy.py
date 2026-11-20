import base64,time
from unittest.mock import patch
import pytest
from application_agent.media_privacy import private_media_page,media_page_state
from application_agent.live_watch import LiveWatch
from application_agent.tests.test_live_watch import Session,SafePage
from application_agent.tests.test_video_encoder import jpeg

@pytest.fixture
def page():
 from playwright.sync_api import sync_playwright
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='chrome',headless=True)
  page=browser.new_page();yield page;browser.close()

@pytest.mark.parametrize('html',[
 '<label>Password<input type="password"></label>',
 '<input autocomplete="one-time-code">',
 '<input name="verification_code">',
 '<input id="security-code">',
 '<p>To submit your application, enter the 8-character code to confirm you are a human.</p><input>',
 '<p>Enter the email verification code</p><input>',
 '<iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>'
])
def test_private_check_is_excluded(page,html):
 page.route('**/*',lambda route:route.abort());page.set_content(html,wait_until='domcontentloaded');assert private_media_page(page)

def test_normal_profile_form_and_hidden_code_are_recordable(page):
 page.set_content('<input name="email"><input name="zip_code"><input name="salary"><input name="code" style="display:none">');assert not private_media_page(page)
 page.close();assert private_media_page(page)

def test_privacy_gate_latches_and_never_accepts_more_frames_until_explicit_reattach():
 watch=LiveWatch(lambda _: {'watching':True},'request','claim',interval=.01,record=True)
 page=SafePage();session=Session();context=type('Context',(),{'new_cdp_session':lambda _,page:session})()
 try:
  watch.attach(context,page);watch.capture(force=True);assert watch.latest
  with patch('application_agent.media_privacy.media_page_state',return_value='private'):watch.capture(force=True)
  assert watch.privacy_latched and watch.latest is None and not watch.active.is_set()
  with patch('application_agent.media_privacy.media_page_state',return_value='safe'):
   session.handler({'sessionId':2,'data':base64.b64encode(jpeg(80)).decode()});assert watch.latest is None
   watch.attach(context,page);watch.capture(force=True);assert watch.active.is_set() and watch.latest
 finally:watch.detach();watch.close();watch.cleanup_recording()

@pytest.mark.parametrize('initially_unavailable',[False,True])
def test_navigation_inspection_failure_blocks_frames_then_recovers_without_a_private_prompt(initially_unavailable):
 class NavigatingFrame:
  url='https://fixture.example/form'
  unavailable=initially_unavailable
  def evaluate(self,*_):
   if self.unavailable:raise RuntimeError('Fixture document is navigating')
   return False
 frame=NavigatingFrame();page=SafePage();page.frames=[frame]
 watch=LiveWatch(lambda _:{'watching':False},'fixture','claim',interval=.01,record=True)
 session=Session();context=type('Context',(),{'new_cdp_session':lambda _,page:session})()
 try:
  watch.attach(context,page);assert watch.session is session
  frame.unavailable=True
  assert media_page_state(page)=='unavailable' and private_media_page(page)
  watch.capture(force=True)
  session.handler({'sessionId':1,'data':base64.b64encode(jpeg(240)).decode()})
  assert not watch.privacy_latched and watch.latest is None and not watch.active.is_set()
  assert watch.recording.latest is None
  frame.unavailable=False;watch.capture(force=True)
  assert watch.latest and watch.active.is_set() and watch.recording.active.is_set()
  assert not watch.privacy_latched and media_page_state(page)=='safe'
 finally:watch.detach();watch.close();watch.cleanup_recording()

def test_full_safe_process_is_recorded_while_private_prompt_is_not(page):
 import av
 from application_agent.video_labels import LABELS
 calls=[];watch=LiveWatch(lambda body:(calls.append(body) or {'watching':True}),'fixture','claim',interval=.01,record=True)
 try:
  page.set_content('<body style="background:rgb(0,160,0)"><label>Name<input></label>')
  watch.attach(page.context,page);watch.set_control('opening');watch.capture(force=True);page.wait_for_timeout(500)
  page.locator('input').fill('Fictional applicant');watch.set_control('agent');watch.capture(force=True);page.wait_for_timeout(400)
  page.set_content('<body style="background:rgb(180,180,0)"><label>Ordinary manual answer<input></label>')
  watch.set_control('manual');page.locator('input').fill('Fictional user response');watch.capture(force=True);page.wait_for_timeout(500)
  page.set_content('<body style="background:rgb(240,0,0)"><p>Enter your email verification code</p><input name="code" value="PRIVATE-FIXTURE">')
  watch.capture(force=True);page.wait_for_timeout(400);assert watch.privacy_latched
  page.set_content('<body style="background:rgb(0,0,200)">Thank you for applying</body>')
  watch.attach(page.context,page);watch.set_control('confirmed');watch.capture(force=True);page.wait_for_timeout(500)
  watch.finish_capture();watch.detach();watch.close();info=watch.recording_info;assert info
  with av.open(str(info['path'])) as movie:
   values=[bytes(frame.planes[0])[100*frame.planes[0].line_size+100] for frame in movie.decode(video=0)]
  assert any(90<v<110 for v in values),values
  assert any(v>140 for v in values),values
  assert any(v<45 for v in values),values
  assert not any(72<v<88 for v in values),values
  assert any(body.get('video',{}).get('kind')=='segment' for body in calls)
 finally:watch.close();watch.cleanup_recording()

def test_fresh_form_navigation_uploads_a_playable_checkpoint_before_ordinary_question_pause(tmp_path):
 """Actual Chrome/CDP/MP4 path; all form traffic is intercepted locally."""
 import av,shutil
 from application_agent.browser import execute_application
 from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan,browser_factory
 parts=[];posts=[]
 def keep(info):
  target=tmp_path/f'part-{len(parts)}.mp4';shutil.move(info['path'],target);parts.append({**info,'path':target})
 watch=LiveWatch(lambda _:{'watching':False},'fixture','claim',interval=.01,record=True,on_part=keep)
 def planning(payload,fields,research):
  deadline=time.monotonic()+5
  while not parts and time.monotonic()<deadline:time.sleep(.05)
  assert parts,'A checkpoint must be ready before form filling has finished'
  assert watch.recording.thread.is_alive()
  return plan(payload,fields,research)
 try:
  html=FORM.replace('{extra}','<label>Ordinary employer question<textarea name="motivation" required></textarea></label>')
  result=execute_application(PAYLOAD,CV,submit=True,planner=planning,research_fn=lambda _:{},resolver=dns,
   playwright_factory=lambda:browser_factory(html,posts),before_submit=lambda:True,timeout=5000,live_watch=watch)
  watch.close()
  assert result['status']=='needs_attention' and not posts,result
  assert not watch.privacy_latched and watch.recording.frames>=16 and parts
  assert any(q['question']=='Ordinary employer question' for q in result['report']['unresolved'])
  for part in parts:
   with av.open(str(part['path'])) as movie:assert len(list(movie.decode(video=0)))>0
 finally:watch.close();watch.cleanup_recording()
