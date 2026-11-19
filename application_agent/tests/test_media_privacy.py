import base64,time
from unittest.mock import patch
import pytest
from application_agent.media_privacy import private_media_page
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
  with patch('application_agent.media_privacy.private_media_page',return_value=True):watch.capture(force=True)
  assert watch.privacy_latched and watch.latest is None and not watch.active.is_set()
  with patch('application_agent.media_privacy.private_media_page',return_value=False):
   session.handler({'sessionId':2,'data':base64.b64encode(jpeg(80)).decode()});assert watch.latest is None
   watch.attach(context,page);watch.capture(force=True);assert watch.active.is_set() and watch.latest
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
