"""Native widget-shaped fixtures only. No real CAPTCHA or employer contacted."""
from urllib.parse import urlsplit
from types import SimpleNamespace
from application_agent.employer_verification import RecaptchaAccess,RECAPTCHA_HOSTS
from application_agent.verification_handoff import BrowserHandoff
from application_agent.tests.test_verification_handoff import hidden_factory
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan
from application_agent.browser import execute_application


class ManualCaptchaFixture(BrowserHandoff):
    def __init__(self,cancel=False):
        self.page=None;self.context=None;self.events=[];self.current=None;self.windows=[];self.cancel=cancel
        super().__init__(self.api,{'requestId':'one','claimId':'fixture-claim'})
    def window(self,context,page,state):
        if self.context is not None:assert self.context is context and self.page is page
        self.context,self.page=context,page;self.windows.append(state)
    def api(self,path,body):
        if body:
            self.events.append(body.copy());self.current={**(self.current or {}),**body,'state':'waiting' if body['event']=='begin' else body['event'],'approvedHosts':[]}
            if body['event']=='opened' and self.current['phase']=='after_submit':
                # A separate synthetic human actor completes a fictional widget.
                for frame in self.page.frames:
                    if 'google.com/recaptcha/' in frame.url:
                        frame.get_by_role('button',name='Complete synthetic check').click()
                        self.page.wait_for_timeout(300)
        else:
            self.current['state']='cancelled' if self.cancel else 'opening' if self.current['state']=='waiting' else 'resuming'
            if self.current['state']=='opening':self.current['approvedHosts']=self.current.get('challengeHosts',[])
        return {'handoff':self.current}


def run_captcha(html,handler):
    posts=[];served=[]
    def employer(req):
        if urlsplit(req.url).hostname=='www.google.com':
            served.append(req.url.split('?')[0])
            if urlsplit(req.url).path.endswith('/bframe'):
                return '<button onclick="parent.postMessage(\'fixture-complete\',\'*\')">Complete synthetic check</button>'
            return {'content_type':'text/javascript','body':'document.documentElement.dataset.fixtureLoaded="yes";'}
        return 'Your application has been submitted' if req.method=='POST' else html
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=1500,
        before_submit=lambda:True,playwright_factory=lambda:hidden_factory(employer,posts),verification_handler=handler)
    return result,posts,served


def test_bootstrap_needs_personal_destination_approval_then_same_form_submits_once():
    h=ManualCaptchaFixture()
    result,posts,served=run_captcha(FORM.replace('{extra}','<script src="https://www.google.com/recaptcha/api.js"></script>'),h)
    assert result['status']=='applied' and len(posts)==1 and CV in posts[0],result
    assert h.events[0]['challengeHosts']==sorted(RECAPTCHA_HOSTS)
    assert [e['event'] for e in h.events]==['begin','opened','resumed']
    assert served==['https://www.google.com/recaptcha/api.js']
    assert result['report']['journey']['submit_click_attempts']==1
    assert result['report']['verification_handoffs'][0]['user_returned_control'] is True


def test_cancelled_recaptcha_grants_no_access_and_does_not_click_submit():
    h=ManualCaptchaFixture(cancel=True)
    result,posts,served=run_captcha(FORM.replace('{extra}','<script src="https://www.google.com/recaptcha/api.js"></script>'),h)
    assert result['status']=='needs_attention' and not posts and not served,result
    assert result['report']['journey']['submit_click_attempts']==0


def test_visible_check_after_first_submit_completes_native_callback_without_second_click():
    h=ManualCaptchaFixture()
    script='''<script>
      document.querySelector('form').onsubmit=e=>{e.preventDefault();const check=document.createElement('iframe');check.src='https://www.google.com/recaptcha/api2/bframe?isolated=fixture';check.id='fixture-check';document.body.append(check);};
      window.addEventListener('message',e=>{if(e.origin==='https://www.google.com'&&e.data==='fixture-complete'){document.getElementById('fixture-check').remove();fetch('/submit',{method:'POST',body:new FormData(document.querySelector('form'))}).then(()=>document.body.textContent='Your application has been submitted');}});
    </script>'''
    result,posts,served=run_captcha(FORM.replace('{extra}',script),h)
    assert result['status']=='applied' and len(posts)==1 and CV in posts[0],{'message':result['message'],'events':h.events,'served':served,'destinations':result['report'].get('blocked_destinations')}
    assert h.events[0]['phase']=='after_submit'
    assert result['report']['journey']['submit_click_attempts']==1
    assert len(served)==1


def test_red_resubmit_error_after_first_click_never_opens_a_retry_handoff():
    h=ManualCaptchaFixture()
    script='''<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();const p=document.createElement('p');p.textContent='Please complete the reCAPTCHA and resubmit your application.';document.body.append(p);};</script>'''
    result,posts,served=run_captcha(FORM.replace('{extra}',script),h)
    assert result['status']=='uncertain' and not posts and not h.events,result
    assert result['report']['confirmation_wait']['outcome']=='verification_required'
    assert result['report']['journey']['submit_click_attempts']==1


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
