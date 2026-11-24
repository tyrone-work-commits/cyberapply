"""Bring the exact in-memory application page forward. Never open or navigate a tab."""
import threading
from uuid import uuid4

class BrowserWindow:
    def __init__(self,call,task,interval=2):
        self.call=call;self.ids={k:task[k] for k in ('requestId','claimId')};self.session_id=str(uuid4());self.interval=interval
        self.stop=threading.Event();self.lock=threading.Lock();self.pending=None;self.handled=None;self.error=None;self.registered=False;self.thread=None;self.page=None;self.context=None
    def attach(self,context,page):
        self.context,self.page=context,page
        self.thread=threading.Thread(target=self._sync,name='CyberApply browser window status',daemon=True);self.thread.start()
    def _exchange(self,event):
        with self.lock:ack=self.handled;error=self.error
        return self.call('/api/application-agent/browser-window',{**self.ids,'sessionId':self.session_id,'event':event,**({'openedId':ack} if ack else {}),**({'error':error} if ack and error else {})})
    def _sync(self):
        while not self.stop.is_set():
            try:
                reply=self._exchange('poll' if self.registered else 'ready');self.registered=True
                with self.lock:self.pending=reply.get('openId')
            except Exception:pass  # Desktop/HTTP outages never restart a page or a submission.
            self.stop.wait(self.interval)
    def check(self):
        # Called only by the Playwright owner thread, including during manual handoffs.
        with self.lock:requested=self.pending;handled=self.handled
        if not requested or requested==handled or not self.page or self.page.is_closed():return
        error=None
        try:
            from .verification_handoff import BrowserHandoff
            BrowserHandoff.window(self,self.context,self.page,'normal')
        except Exception:error='window_unavailable'
        with self.lock:self.handled=requested;self.error=error
    def close(self):
        self.suspend()
        if self.registered:
            try:self._exchange('closed')
            except Exception:pass
    def suspend(self):
        """Let the manual form's owner thread report its actual liveness."""
        self.stop.set()
        if self.thread:self.thread.join(timeout=5)
