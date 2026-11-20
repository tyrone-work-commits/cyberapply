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
