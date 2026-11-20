"""Runner-owned Windows visibility; fictional forms only, zero final submissions."""
import sys
import time
from contextlib import contextmanager
from unittest.mock import patch
import pytest
from application_agent.window_visibility import BrowserVisibility,WindowsChrome
from application_agent.verification_handoff import BrowserHandoff
from application_agent.manual_submit import ManualSubmit
from application_agent.browser import execute_application
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan
from application_agent.tests.test_manual_submit import Actor


class Native:
    def __init__(self):self.visible=False;self.hidden_calls=0;self.shown=0
    def hide(self):self.visible=False;self.hidden_calls+=1
    def show(self):self.visible=True;self.shown+=1


def test_hidden_guard_never_shows_and_explicit_show_preserves_owner_control():
    native=Native();control=BrowserVisibility(native)
    try:
        time.sleep(.12);assert native.hidden_calls>0 and not native.visible and native.shown==0
        control.show();time.sleep(.12);assert native.visible and native.shown==1
        control.hide();assert not native.visible
        control.show();assert native.visible and native.shown==2
    finally:control.close()
    assert not control.thread.is_alive()


def test_visibility_failure_does_not_silently_show_the_browser():
    class Failed(Native):
        def hide(self):raise OSError('fixture')
    control=BrowserVisibility(Failed())
    try:
        time.sleep(.08)
        with pytest.raises(OSError):control.show()
        assert control.native.shown==0
    finally:control.close()


def test_process_identity_is_taken_from_browser_cdp_not_chrome_titles():
    class Browser:
        def new_browser_cdp_session(self):return self
        def send(self,name):assert name=='SystemInfo.getProcessInfo';return {'processInfo':[{'type':'renderer','id':12},{'type':'browser','id':42}]}
        def detach(self):self.detached=True
    browser=Browser();context=type('Context',(),{})()
    with patch('application_agent.window_visibility.sys.platform','win32'),patch('application_agent.window_visibility.WindowsChrome',return_value=Native()) as factory:
        control=BrowserVisibility.attach(browser,context)
        try:factory.assert_called_once_with(42);assert browser.detached and context._cyberapply_visibility is control
        finally:control.close()


def test_native_enumeration_excludes_other_chrome_processes_and_helper_windows():
    class User:
        def EnumWindows(self,callback,_):
            for hwnd in (1,2,3):callback(hwnd,0)
            return True
        def GetWindowThreadProcessId(self,hwnd,pid):pid._obj.value=42 if hwnd!=2 else 99
        def GetClassNameW(self,hwnd,name,_):name.value='Chrome_WidgetWin_1' if hwnd!=3 else 'Chrome_RenderWidgetHostHWND'
    native=object.__new__(WindowsChrome);native.pid=42;native.user=User();native.callback=lambda fn:fn
    assert native.windows()==[1]


@pytest.mark.skipif(sys.platform!='win32',reason='Real Windows Chrome visibility acceptance')
def test_real_headed_form_is_hidden_until_open_and_pre_submit_close_can_be_refilled():
    observations=[];posts=[]
    class NativeActor(Actor):
        def __init__(self,close):super().__init__(posts,close=close)
        def minimize(self,context,page):
            self.context,self.page=context,page;self.minimized+=1;ManualSubmit.minimize(self,context,page)
        def window(self,context,page):
            assert self.open_issued
            assert page.locator('input[type=file]').evaluate('e=>e.files[0].name')=='chosen.pdf'
            assert page.get_by_label('Email').input_value()=='alex@example.com'
            ManualSubmit.window(self,context,page);self.windows+=1
            native=context._cyberapply_visibility.native
            windows=native.windows();assert windows and all(native.user.IsWindowVisible(w) and not native.user.IsIconic(w) for w in windows)
            observations.append('filled_before_visible')
            if self.close:page.close()
        def api(self,path,body):
            if body['event']=='ready':
                native=self.context._cyberapply_visibility.native
                assert self.context._cyberapply_visibility.hidden
                assert native.windows() and all(not native.user.IsWindowVisible(w) for w in native.windows())
                observations.append('ready_hidden')
            result=super().api(path,body)
            if self.windows and not self.close:result['session']['state']='cancel_requested'
            return result
    @contextmanager
    def factory():
        from playwright.sync_api import sync_playwright
        with sync_playwright() as runtime:
            launch=runtime.chromium.launch
            def headed(**kwargs):
                kwargs['channel']='chrome';browser=launch(**kwargs);new=browser.new_context
                def context(**options):
                    ctx=new(**options);route=ctx.route
                    def intercept(pattern,guard):
                        def dispatch(request_route):
                            class Route:
                                request=request_route.request
                                def continue_(self):
                                    assert self.request.method in {'GET','HEAD','OPTIONS'}, 'No fixture submits allowed'
                                    request_route.fulfill(status=200,content_type='text/html',body=FORM.replace('{extra}',''))
                                def abort(self):request_route.abort()
                            guard(Route())
                        route(pattern,dispatch)
                    ctx.route=intercept;return ctx
                browser.new_context=context;return browser
            runtime.chromium.launch=headed;yield runtime
    payload={**PAYLOAD,'job':{**PAYLOAD['job'],'applyUrl':'https://job-boards.greenhouse.io/fixture/jobs/123'}}
    for close in (True,False):
        actor=NativeActor(close);handoff=BrowserHandoff(lambda *_:None,{'requestId':'one','claimId':'fixture-claim'})
        result=execute_application(payload,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,timeout=1500,before_submit=lambda:True,playwright_factory=factory,verification_handler=handoff,manual_submit_handler=actor)
        assert result['status']==('needs_attention' if close else 'uncertain'),result
        assert actor.windows==1 and result['report']['journey']['submit_click_attempts']==0
        assert result['report']['journey']['human_submit_observed']==0 and not result['report']['journey']['possible_delivery']
    assert observations==['ready_hidden','filled_before_visible']*2
