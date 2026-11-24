"""Isolated, fully intercepted employer forms. Synthetic human actor only."""
from contextlib import contextmanager
from urllib.parse import urlsplit
import pytest
from application_agent.manual_submit import ManualSubmit, confirmation_url
from application_agent.verification_handoff import BrowserHandoff
from application_agent.browser import execute_application
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan,browser_factory


class Actor(ManualSubmit):
    def __init__(self,posts,cancel=False,outage=0,red=False,close=False,close_after_click=False):
        self.close=close;self.close_after_click=close_after_click
        self.posts=posts;self.cancel=cancel;self.outage=outage;self.red=red;self.events=[];self.session=None;self.notifications=0;self.calls=0;self.windows=0;self.real_pages=[];self.minimized=0;self.open_issued=False
        super().__init__(self.api,{'requestId':'one','claimId':'fixture-claim'},notify=self.notification)
    def notification(self):self.notifications+=1;return True
    def minimize(self,context,page):self.context=context;self.page=page;self.minimized+=1
    def window(self,context,page):
        self.context=context;self.page=page;self.real_pages.append(page);self.windows+=1
        assert self.open_issued, 'Window focused before the synthetic user requested Open.'
        if self.close:
            if self.close_after_click:
                self.page.evaluate("()=>{document.querySelector('form').addEventListener('submit',e=>e.preventDefault());}")
                self.page.get_by_role('button',name='Submit application').click(no_wait_after=True,timeout=1500)
            self.page.close();return
        if not self.cancel:
            # Separate synthetic human actor acts only after checkbox-confirmed Open.
            if self.page.get_by_role('button',name='Verify fixture').count():self.page.get_by_role('button',name='Verify fixture').click()
            self.page.get_by_role('button',name='Submit application').click()
            self.page.wait_for_timeout(150)
    def api(self,path,body):
        self.calls+=1
        if self.calls<=self.outage:raise OSError('Synthetic temporary outage')
        event=body['event'];self.events.append(event)
        if self.session is None:
            assert not self.posts
            assert self.page.locator('input[type=file]').evaluate('e=>e.files[0].name')=='chosen.pdf'
            self.session={**body,'state':'ready','approvedHosts':[]}
            assert self.windows==0 and self.notifications==1
        if self.cancel:self.session['state']='cancel_requested'
        if event=='confirmed':self.session['state']='confirmed';assert body['evidence']['text']
        if event=='closed_before_submit':self.session['state']='closed_before_submit';assert not self.posts
        if event=='cancelled':self.session['state']='cancelled'
        if event=='needs_submit':
            self.session['state']='needs_submit'
            assert len(self.posts)==0
            # Leave the red validation error in place across polls. No retry is allowed.
        if self.red and event=='poll' and 'needs_submit' in self.events:
            assert not self.posts;self.session['state']='cancel_requested'
        reply={**self.session,'openRequested':False}
        if event=='poll' and not self.cancel and not self.open_issued:
            self.open_issued=True;reply['openRequested']=True
        return {'session':reply}


def run_manual(html,greenhouse=False,cancel=False,outage=0,red=False,close=False,close_after_click=False):
    posts=[];launch=[];actor=Actor(posts,cancel,outage,red,close,close_after_click)
    @contextmanager
    def factory():
        with browser_factory(html,posts) as runtime:
            old=runtime.chromium.launch
            def hidden(**kwargs):launch.append(kwargs);return old(**{**kwargs,'headless':True})
            runtime.chromium.launch=hidden;yield runtime
    payload={**PAYLOAD,'job':{**PAYLOAD['job'],'applyUrl':'https://job-boards.greenhouse.io/fixture/jobs/123'}} if greenhouse else PAYLOAD
    class LegacyFocus:
        def attach(self,*_):pass
        def check(self):assert not actor.active, 'Legacy focus must not bypass manual checkbox/open.'
        def close(self):pass
    handoff=BrowserHandoff(lambda *_:None,{'requestId':'one','claimId':'fixture-claim'})
    result=execute_application(payload,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,timeout=1500,before_submit=lambda:True,playwright_factory=factory,verification_handler=handoff,manual_submit_handler=actor,browser_window=LegacyFocus())
    return result,posts,actor,launch


@pytest.mark.parametrize('greenhouse,extra',[(True,''),(False,'<div class="g-recaptcha" data-sitekey="fixture-only"></div>'),(False,'<p>Protected by reCAPTCHA</p>')])
def test_runner_never_clicks_protected_submit_and_human_confirmation_is_required(greenhouse,extra):
    result,posts,actor,launch=run_manual(FORM.replace('{extra}',extra),greenhouse)
    assert result['status']=='applied',result
    assert len(posts)==1 and CV in posts[0]
    assert result['report']['journey']['submit_click_attempts']==0
    assert actor.notifications==1 and actor.windows==1
    assert launch[0]['headless'] is False and '--start-minimized' in launch[0]['args']
    assert actor.minimized>=2 and actor.open_issued
    assert all(p is actor.page for p in actor.real_pages)


def test_cancel_keeps_application_unverified_and_does_not_submit():
    result,posts,actor,_=run_manual(FORM.replace('{extra}',''),True,cancel=True)
    assert result['status']=='uncertain' and not posts
    assert result['report']['journey']['submit_click_attempts']==0
    assert actor.windows==0 and actor.notifications==1 and actor.minimized>=2


def test_accidental_close_before_submit_keeps_recoverable_ready_state_without_submitting():
    result,posts,actor,_=run_manual(FORM.replace('{extra}',''),True,close=True)
    assert result['status']=='needs_attention' and not posts,result
    assert 'closed_before_submit' in actor.events and 'cancelled' not in actor.events
    assert result['report']['journey']['human_submit_observed']==0
    assert result['report']['journey']['possible_delivery'] is False


def test_submit_then_close_is_uncertain_even_when_validation_prevents_a_post():
    result,posts,actor,_=run_manual(FORM.replace('{extra}',''),True,close=True,close_after_click=True)
    assert result['status']=='uncertain' and not posts,result
    assert 'closed_before_submit' not in actor.events and 'cancelled' in actor.events
    assert result['report']['journey']['human_submit_observed']>0


def test_temporary_connection_failure_keeps_exact_page_and_selected_cv():
    result,posts,actor,_=run_manual(FORM.replace('{extra}',''),True,outage=2)
    assert result['status']=='applied' and len(posts)==1,result
    assert actor.calls>=3 and actor.notifications==1
    assert result['report']['journey']['submit_click_attempts']==0


def test_red_recaptcha_error_waits_without_retrying_submit():
    extra='<script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.body.insertAdjacentHTML("beforeend","<p>Please complete the reCAPTCHA and resubmit your application.</p>");};</script>'
    result,posts,actor,_=run_manual(FORM.replace('{extra}',extra),True,red=True)
    assert result['status']=='uncertain' and not posts,result
    assert 'needs_submit' in actor.events and actor.events.count('ready')==1
    assert result['report']['journey']['submit_click_attempts']==0


def test_only_new_exact_greenhouse_vacancy_confirmation_url_counts():
    before='https://job-boards.greenhouse.io/fixture/jobs/123'
    assert confirmation_url(before,before+'/confirmation')
    assert confirmation_url(before,before+'/thank_you')
    for url in [before,before+'#confirmation',before+'?confirmation=yes','https://evil.test/fixture/jobs/123/confirmation','https://job-boards.greenhouse.io/other/jobs/123/confirmation','https://job-boards.greenhouse.io/fixture/jobs/999/confirmation']:
        assert not confirmation_url(before,url)


def test_disabled_submit_waits_for_person_instead_of_closing_as_ambiguous():
    html=FORM.replace('{extra}','<button type="button" onclick="document.querySelector(\'button[type=submit]\').disabled=false">Verify fixture</button>').replace('<button type="submit">','<button type="submit" disabled>')
    result,posts,actor,_=run_manual(html,True)
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['submit_click_attempts']==0

def test_repeated_exact_open_nonce_is_acknowledged_without_refocusing_or_submitting():
    posts=[];calls=[];opened=[]
    nonce='5a814bd1-4d80-42e3-8d60-8cf850a49501'
    class NoSubmit(ManualSubmit):
        def minimize(self,context,page):self.page=page
        def window(self,context,page):opened.append(id(page))
        def api(self,path,body):
            calls.append(body)
            assert body['browserHealthVersion']==1 and body['browserSessionId']==self.id
            return {'session':{'state':'cancel_requested' if len(calls)>=4 else 'ready','openRequested':True,'openCommandId':nonce,'approvedHosts':[]}}
    actor=NoSubmit(None,{'requestId':'one','claimId':'fixture-claim'},notify=None);actor.call=actor.api
    @contextmanager
    def factory():
        with browser_factory(FORM.replace('{extra}','<p>Protected by reCAPTCHA</p>'),posts) as runtime:
            launch=runtime.chromium.launch
            runtime.chromium.launch=lambda **kw:launch(**{**kw,'headless':True})
            yield runtime
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,timeout=1500,before_submit=lambda:True,playwright_factory=factory,manual_submit_handler=actor)
    # Ordinary employer forms without reCAPTCHA submit automatically, so mark
    # this isolated fixture as protected by its content.
    assert not posts
    assert result['status']=='uncertain'
    assert len(opened)==1 and calls[-1]['openedCommandId']==nonce
