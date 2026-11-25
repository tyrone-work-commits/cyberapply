"""Native widget-shaped fixtures only; no real CAPTCHA or employer contacted."""
from urllib.parse import urlsplit
from types import SimpleNamespace
from contextlib import contextmanager
from application_agent.employer_verification import RecaptchaAccess,RECAPTCHA_HOSTS
from application_agent.verification_handoff import BrowserHandoff
from application_agent.manual_submit import ManualSubmit
from application_agent.tests.test_verification_handoff import hidden_factory
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan
from application_agent.browser import execute_application

class ExplicitAccess(ManualSubmit):
 def __init__(self,cancel=False):
  self.page=None;self.context=None;self.events=[];self.current=None;self.cancel=cancel;self.clicked=False
  super().__init__(self.api,{'requestId':'one','claimId':'fixture'},notify=lambda:True)
 def window(self,context,page):self.context,self.page=context,page
 def api(self,path,body):
  self.events.append(body['event'])
  if self.current is None:self.current={**body,'state':'cancel_requested' if self.cancel else 'ready','approvedHosts':body['challengeHosts']}
  elif body['event']=='poll' and not self.clicked and not self.cancel:
   self.clicked=True;self.page.get_by_role('button',name='Submit application').click();self.page.wait_for_timeout(150)
  if body['event']=='confirmed':self.current['state']='confirmed'
  return {'session':self.current}

def run_captcha(handler):
 posts=[];served=[]
 def employer(req):
  if urlsplit(req.url).hostname=='www.google.com':
   served.append(req.url.split('?')[0]);return {'content_type':'text/javascript','body':'document.documentElement.dataset.fixtureLoaded="yes";'}
  return 'Your application has been submitted' if req.method=='POST' else FORM.replace('{extra}','<script src="https://www.google.com/recaptcha/api.js"></script>')
 h=BrowserHandoff(lambda *_:None,{'requestId':'one','claimId':'fixture'})
 result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=1500,before_submit=lambda:True,playwright_factory=lambda:hidden_factory(employer,posts),verification_handler=h,manual_submit_handler=handler)
 return result,posts,served

def test_explicit_native_resource_access_restores_only_script_then_human_submits():
 h=ExplicitAccess();result,posts,served=run_captcha(h)
 assert result['status']=='applied' and len(posts)==1 and CV in posts[0],result
 assert h.current['challengeHosts']==sorted(RECAPTCHA_HOSTS)
 assert served==['https://www.google.com/recaptcha/api.js']
 assert result['report']['journey']['submit_click_attempts']==0

def test_cancelled_manual_session_does_not_grant_resources_or_click_submit():
 h=ExplicitAccess(cancel=True);result,posts,served=run_captcha(h)
 assert result['status']=='uncertain' and not posts and not served,result
 assert result['report']['journey']['submit_click_attempts']==0

def test_resource_access_is_explicit_pinned_and_never_allows_employer_post_to_google():
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    req=SimpleNamespace(url='https://www.google.com/recaptcha/api2/reload',method='POST',resource_type='xhr',frame=SimpleNamespace(url='https://employer.example/apply'))
    assert access.permit(req) is False
    access.approved=set(RECAPTCHA_HOSTS)
    assert access.permit(req) is False
    req.frame.url='https://www.google.com/recaptcha/api2/anchor'
    assert access.permit(req) is True
    req.url='https://www.google.com/drive/'
    assert access.permit(req) is None
    req.url='https://www.google.com/recaptcha/api2/reload';access.pins=set()
    assert access.permit(req) is False


def test_approved_bootstrap_recovery_uses_its_original_embedded_frame():
    from unittest.mock import Mock
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    frame=Mock();frame.url='https://job-boards.greenhouse.io/embed/job_app?for=fixture';frame.is_detached.return_value=False
    req=SimpleNamespace(url='https://www.google.com/recaptcha/api.js?render=fixture',method='GET',resource_type='script',frame=frame)
    assert access.permit(req) is False
    page=Mock();page.frames=[Mock(),frame]
    access.approved=set(RECAPTCHA_HOSTS)
    frame.evaluate.return_value=True
    outcome=access.restore(page)
    assert frame.evaluate.call_count==1
    page.evaluate.assert_not_called()
    assert outcome=={'attempted':1,'restarted':1,'unavailable':0}
    assert access.restore(page)=={'attempted':0,'restarted':0,'unavailable':0}


def test_bootstrap_recovery_never_reloads_a_navigated_or_detached_form():
    from unittest.mock import Mock
    for detached,navigate in [(True,False),(False,True)]:
        access=RecaptchaAccess(RECAPTCHA_HOSTS)
        frame=Mock();frame.url='https://employer.example/apply';frame.is_detached.return_value=detached
        req=SimpleNamespace(url='https://www.google.com/recaptcha/api.js',method='GET',resource_type='script',frame=frame)
        access.permit(req);access.approved=set(RECAPTCHA_HOSTS)
        if navigate:frame.url='https://employer.example/other'
        page=Mock();page.frames=[frame]
        assert access.restore(page)=={'attempted':1,'restarted':0,'unavailable':1}
        frame.evaluate.assert_not_called();frame.goto.assert_not_called();page.reload.assert_not_called()


def test_embedded_bootstrap_retry_preserves_filled_form_and_cv_without_submit():
    from playwright.sync_api import sync_playwright
    access=RecaptchaAccess(RECAPTCHA_HOSTS);served=[];posts=[]
    top='https://employer.example/apply';embedded='https://job-boards.greenhouse.io/fixture/jobs/123'
    script='https://www.google.com/recaptcha/api.js?render=isolated-fixture'
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(service_workers='block')
        def route(r):
            req=r.request
            if req.method!='GET':posts.append(req.method);r.abort();return
            if req.url==script:
                if access.permit(req):
                    served.append('verification bootstrap');r.fulfill(content_type='text/javascript',body='document.documentElement.dataset.fixtureWidget="loaded";')
                else:r.abort()
            elif req.url==top:r.fulfill(content_type='text/html',body='<iframe src="'+embedded+'"></iframe>')
            elif req.url==embedded:r.fulfill(content_type='text/html',body='<form><input id="preserved" value="Fictional saved answer"><input type="file"><script src="'+script+'"></script><button type="submit">Submit application</button></form>')
            else:r.abort()
        context.route('**/*',route);page=context.new_page();page.goto(top)
        frame=next(f for f in page.frames if f.url==embedded)
        frame.locator('#preserved').wait_for()
        frame.locator('input[type=file]').set_input_files({'name':'fictional-cv.txt','mimeType':'text/plain','buffer':b'Fictional test CV'})
        assert len(access.resources)==1 and not served
        access.approved=set(RECAPTCHA_HOSTS)
        assert access.restore(page)=={'attempted':1,'restarted':1,'unavailable':0}
        frame.wait_for_function('document.documentElement.dataset.fixtureWidget==="loaded"',timeout=3000)
        assert served==['verification bootstrap'] and not posts
        assert frame.locator('#preserved').input_value()=='Fictional saved answer'
        assert frame.locator('input[type=file]').evaluate('e=>e.files[0].name')=='fictional-cv.txt'
        assert page.url==top and frame.url==embedded
        assert access.restore(page)=={'attempted':0,'restarted':0,'unavailable':0}
        browser.close()


def test_widget_document_recovery_is_exact_and_keeps_unapproved_resources_pending():
    from unittest.mock import Mock
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    parent=Mock();parent.url='https://employer.example/apply';parent.is_detached.return_value=False
    frame=Mock();frame.url='about:blank';frame.parent_frame=parent;frame.is_detached.return_value=False
    url='https://www.google.com/recaptcha/api2/anchor?fixture=only'
    req=SimpleNamespace(url=url,method='GET',resource_type='document',frame=frame)
    access.permit(req)
    page=Mock();page.frames=[parent,frame];page.main_frame=parent
    assert access.restore(page)=={'attempted':0,'restarted':0,'unavailable':0}
    assert len(access.resources)==1
    element=Mock();element.evaluate.return_value=url;element.element_handle.return_value.content_frame.return_value=frame
    parent.locator.return_value.all.return_value=[element]
    access.approved={'www.google.com'}
    assert access.restore(page)=={'attempted':1,'restarted':1,'unavailable':0}
    frame.goto.assert_called_once_with(url,wait_until='domcontentloaded',timeout=5000)
    parent.goto.assert_not_called();page.reload.assert_not_called()


def test_a_replaced_widget_frame_is_never_navigated_by_old_recovery():
    from unittest.mock import Mock
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    parent=Mock();parent.url='https://employer.example/apply';parent.is_detached.return_value=False
    old=Mock();old.url='about:blank';old.parent_frame=parent
    url='https://www.google.com/recaptcha/api2/anchor?fixture=only'
    access.permit(SimpleNamespace(url=url,method='GET',resource_type='document',frame=old))
    replacement=Mock();element=Mock();element.evaluate.return_value=url;element.element_handle.return_value.content_frame.return_value=replacement
    parent.locator.return_value.all.return_value=[element]
    page=Mock();page.frames=[parent,replacement];page.main_frame=parent;access.approved={'www.google.com'}
    assert access.restore(page)=={'attempted':1,'restarted':0,'unavailable':1}
    replacement.goto.assert_not_called();old.goto.assert_not_called();parent.goto.assert_not_called()


def test_approved_employer_page_can_read_native_verification_resources():
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    req=SimpleNamespace(url='https://www.recaptcha.net/recaptcha/enterprise/anchor?fixture=not-retained',method='GET',resource_type='fetch',frame=SimpleNamespace(url='https://employer.example/apply'))
    assert access.permit(req) is False
    access.approved={'www.recaptcha.net'}
    assert access.permit(req) is True
    req.resource_type='xhr';assert access.permit(req) is True
    req.method='POST';assert access.permit(req) is False
    access.pins.clear();req.method='GET';assert access.permit(req) is False


def test_verification_diagnostics_do_not_store_tokens_urls_or_applicant_data():
    import json
    secret='PRIVATE_TOKEN_AND_CV_TEXT'
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    req=SimpleNamespace(url='https://www.google.com/recaptcha/enterprise/anchor?token='+secret,method='GET',resource_type='fetch',frame=SimpleNamespace(url='https://employer.example/apply?email='+secret),failure='unexpected failure '+secret)
    access.permit(req)
    access.observe_response(SimpleNamespace(url=req.url,status=403,request=req))
    access.observe_failure(req)
    saved=access.summary()
    assert secret not in json.dumps(saved)
    assert 'https://' not in json.dumps(saved)
    assert saved['blocked']==1
    assert {row['outcome'] for row in saved['events']}=={'approval_required','http_error','network_error'}
    assert next(row for row in saved['events'] if row['outcome']=='network_error')['error']=='request_failed'


def test_verification_diagnostics_remain_bounded_and_record_failure_kind():
    access=RecaptchaAccess(RECAPTCHA_HOSTS)
    req=SimpleNamespace(url='https://www.google.com/recaptcha/api.js',method='GET',resource_type='script',frame=SimpleNamespace(url='https://employer.example/apply'),failure='net::ERR_NAME_NOT_RESOLVED')
    for status in range(400,500):access.observe_response(SimpleNamespace(url=req.url,status=status,request=req))
    assert len(access.summary()['events'])==24
    other=RecaptchaAccess(RECAPTCHA_HOSTS);other.observe_failure(req)
    assert other.summary()['events'][0]['error']=='net::ERR_NAME_NOT_RESOLVED'


def test_native_widget_bootstrap_can_finish_approved_read_before_synthetic_human_submit():
    class ReadyActor(ExplicitAccess):
        def api(self,path,body):
            if self.current and body['event']=='poll' and not self.clicked:
                self.page.wait_for_function('document.documentElement.dataset.verificationReady==="yes"',timeout=3000)
            return super().api(path,body)
    posts=[];served=[]
    def employer(req):
        parsed=urlsplit(req.url)
        if parsed.hostname=='www.google.com':
            served.append((parsed.path,req.resource_type))
            if parsed.path.endswith('api.js'):
                return {'content_type':'text/javascript','body':"fetch('https://www.google.com/recaptcha/enterprise/anchor?fixture=only').then(r=>r.text()).then(()=>document.documentElement.dataset.verificationReady='yes');"}
            return {'content_type':'text/plain','body':'ISOLATED READ FIXTURE; NOT A REAL CAPTCHA'}
        return 'Your application has been submitted' if req.method=='POST' else FORM.replace('{extra}','<script src="https://www.google.com/recaptcha/api.js"></script>')
    actor=ReadyActor();handoff=BrowserHandoff(lambda *_:None,{'requestId':'one','claimId':'fixture'})
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=1500,before_submit=lambda:True,playwright_factory=lambda:hidden_factory(employer,posts),verification_handler=handoff,manual_submit_handler=actor)
    assert result['status']=='applied' and len(posts)==1 and CV in posts[0],result
    assert ('/recaptcha/enterprise/anchor','fetch') in served
    assert result['report']['journey']['submit_click_attempts']==0
    diagnostics=result['report']['manual_submission']['verification_connection']
    assert diagnostics['allowed']>=2
