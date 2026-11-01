"""Read-only browser snapshots for an authenticated owner's short-lived viewer.

Only CDP callbacks touch Playwright. The uploader thread receives JPEG bytes,
never page controls or cookies. Viewer failures cannot retry an application.
"""
import threading
import time


class LiveWatch:
    def __init__(self, call, request_id, claim_id, interval=1.5):
        self.call=call
        self.ids={'requestId':request_id,'claimId':claim_id}
        self.interval=interval
        self.stop_event=threading.Event()
        self.watching=threading.Event()
        self.lock=threading.Lock()
        self.latest=None
        self.session=None
        self.last_capture=0
        self.thread=threading.Thread(target=self._upload,name='CyberApply live view',daemon=True)
        self.thread.start()

    def attach(self, context, page):
        self.detach()
        try:
            session=context.new_cdp_session(page)
            self.session=session
            def frame(event):
                try:session.send('Page.screencastFrameAck',{'sessionId':event['sessionId']})
                except Exception:return
                data=event.get('data','')
                if self.session is session and self.watching.is_set() and isinstance(data,str) and 0<len(data)<=320000:
                    with self.lock:self.latest=(data,time.monotonic())
            session.on('Page.screencastFrame',frame)
            session.send('Page.startScreencast',{'format':'jpeg','quality':45,'maxWidth':1280,'maxHeight':800,'everyNthFrame':1})
        except Exception:
            self.detach()  # An unsupported viewer does not stop form processing.

    def detach(self):
        if self.session:
            try:self.session.send('Page.stopScreencast')
            except Exception:pass
            try:self.session.detach()
            except Exception:pass
            self.session=None
        with self.lock:self.latest=None

    def capture(self):
        if not self.session or not self.watching.is_set() or time.monotonic()-self.last_capture<1.5:return
        self.last_capture=time.monotonic()
        try:
            data=self.session.send('Page.captureScreenshot',{'format':'jpeg','quality':45})['data']
            if len(data)<=320000:
                with self.lock:self.latest=(data,time.monotonic())
        except Exception:pass

    def _upload(self):
        while not self.stop_event.is_set():
            try:
                with self.lock:latest=self.latest;self.latest=None
                data=latest[0] if latest and time.monotonic()-latest[1]<8 else None
                body={**self.ids,**({'frame':data} if data and self.watching.is_set() else {})}
                reply=self.call(body)
                if reply.get('watching') is True:self.watching.set()
                else:
                    self.watching.clear()
                    with self.lock:self.latest=None
            except Exception:
                self.watching.clear()
                with self.lock:self.latest=None
            self.stop_event.wait(self.interval)

    def close(self):
        self.stop_event.set()
        self.thread.join(timeout=5)
        # No Playwright access here: execute_application already detached on
        # its owning thread before closing the browser.
        try:self.call({**self.ids,'stop':True})
        except Exception:pass
