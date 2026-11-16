"""Exact-session focusing only; fixtures never contact employers."""
import threading
from unittest.mock import patch
from application_agent.browser_window import BrowserWindow
from application_agent.browser import execute_application
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan,browser_factory

class Page:
    def __init__(self):self.front=0
    def is_closed(self):return False
    def bring_to_front(self):self.front+=1
class Context:
    def __init__(self,page):self.page=page;self.calls=[]
    def new_cdp_session(self,page):
        assert page is self.page
        context=self
        class Session:
            def send(self,name,args=None):
                context.calls.append((name,args,threading.get_ident()))
                return {'windowId':42} if name=='Browser.getWindowForTarget' else {}
            def detach(self):pass
        return Session()

def test_focus_is_main_thread_exact_page_and_idempotent_even_when_acknowledgement_is_lost():
    page=Page();context=Context(page);calls=[]
    control=BrowserWindow(lambda path,body:calls.append((path,body)) or {},{'requestId':'request','claimId':'claim'})
    control.context,control.page=context,page;control.pending='open-one'
    control.check();control.check();control._exchange('poll')
    assert page.front==1 and all(c[2]==threading.get_ident() for c in context.calls)
    assert calls[-1][1]['openedId']=='open-one'
    assert set(calls[-1][1])=={'requestId','claimId','sessionId','event','openedId'}
    control.pending='open-two';control.check();assert page.front==2
    assert [c[0] for c in context.calls]==['Browser.getWindowForTarget','Browser.setWindowBounds']*2

def test_network_worker_exchanges_only_metadata_and_closes_without_recreating_the_page():
    ready=threading.Event();calls=[]
    def api(path,body):
        calls.append((path,body,threading.get_ident()));ready.set();return {'openId':'requested'}
    page=Page();context=Context(page);control=BrowserWindow(api,{'requestId':'request','claimId':'claim'},interval=.01)
    control.attach(context,page);assert ready.wait(2)
    control.stop.wait(.03);assert not context.calls and page.front==0
    control.check();control.close()
    assert page.front==1 and calls[-1][1]['event']=='closed'
    assert all(row[1]['sessionId']==control.session_id for row in calls)

def test_focus_failure_is_reported_without_navigation_or_submit():
    page=Page();control=BrowserWindow(lambda path,body:body,{'requestId':'request','claimId':'claim'})
    control.context,control.page=object(),page;control.pending='open-one';control.check()
    assert control.error=='window_unavailable' and control._exchange('poll')['error']=='window_unavailable'
    control.check();assert page.front==0

def test_focusing_during_preparation_preserves_original_page_filled_email_cv_and_fields():
    observed=[];posts=[]
    class Focus(BrowserWindow):
        def attach(self,context,page):self.context,self.page=context,page
        def check(self):
            if self.page.locator('input[type=file]').evaluate('e=>e.files.length') and not self.handled:
                self.pending='user-open'
            super().check()
        def close(self):self.closed=True
    control=Focus(lambda *args:{}, {'requestId':'one','claimId':'fixture-claim'})
    def foreground(_self,context,page,state):
        assert context is control.context and page is control.page and len(context.pages)==1
        assert page.get_by_label('Email').input_value()=='alex@example.com'
        assert page.locator('input[type=file]').evaluate('e=>e.files[0].name')=='chosen.pdf'
        assert page.get_by_label('Note').input_value()=='keep this'
        observed.append(page.url)
    with patch('application_agent.verification_handoff.BrowserHandoff.window',foreground):
        result=execute_application(PAYLOAD,CV,submit=False,planner=plan,research_fn=lambda _: {'sources':[]},resolver=dns,timeout=3000,before_submit=lambda:True,browser_window=control,playwright_factory=lambda:browser_factory(FORM.replace('{extra}','<label>Note<input name="note" value="keep this"></label>'),posts))
    assert observed==['https://employer.example/apply'] and not posts and control.closed
    assert result['status']=='needs_attention'
