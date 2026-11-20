import unittest
from unittest.mock import patch
from types import SimpleNamespace
from application_agent.login_handoff import sign_in

class HandoffTests(unittest.TestCase):
    def fixture(self,cancel=False):
        callbacks={}
        class Window:
            def __getattr__(self,name):return lambda *a,**k:None
            def update(self):callbacks['Cancel' if cancel else 'I have signed in — continue application']()
        class Widget:
            def pack(self,**kwargs):pass
        def button(window,text,command):callbacks[text]=command;return Widget()
        tk=SimpleNamespace(Tk=Window,Label=lambda *a,**k:Widget(),Button=button)
        class Page:
            url='https://employer.example/apply'
            def goto(self,*a,**k):pass
            def wait_for_timeout(self,*a):pass
            def locator(self,*a):return SimpleNamespace(count=lambda:0)
        context=SimpleNamespace(route_web_socket=lambda *a:None,add_init_script=lambda *a:None,route=lambda *a:None,new_page=Page,storage_state=lambda:{'cookies':[],'origins':[]})
        calls=[]
        browser=SimpleNamespace(new_context=lambda **k:context,close=lambda:calls.append('closed'))
        runtime=SimpleNamespace(chromium=SimpleNamespace(launch=lambda **k:(calls.append(k) or browser)))
        return tk,runtime,calls

    def test_private_handoff_returns_session_after_user_continues(self):
        tk,runtime,calls=self.fixture()
        with patch.dict('sys.modules',{'tkinter':tk}),patch('application_agent.browser.validate_public_url',return_value='employer.example'):
            result=sign_in(runtime,{'headless':True},None,'https://employer.example/login',{'employer.example'},lambda:True)
        self.assertEqual(result['state'],{'cookies':[],'origins':[]})
        self.assertFalse(calls[0]['headless'])
        self.assertEqual(calls[-1],'closed')

    def test_cancel_returns_no_session(self):
        tk,runtime,calls=self.fixture(cancel=True)
        with patch.dict('sys.modules',{'tkinter':tk}):
            self.assertIsNone(sign_in(runtime,{},None,'https://employer.example/login',{'employer.example'},lambda:True))
        self.assertEqual(calls[-1],'closed')

    def test_revoked_request_cannot_complete_private_handoff(self):
        from application_agent.browser import ApplicationAttention
        tk,runtime,calls=self.fixture()
        with patch.dict('sys.modules',{'tkinter':tk}):
            with self.assertRaises(ApplicationAttention):
                sign_in(runtime,{},None,'https://employer.example/login',{'employer.example'},lambda:False)
        self.assertEqual(calls[-1],'closed')
