"""Keep this runner's headed Chrome windows hidden until an explicit handoff.

Scope comes from Chrome's browser-process CDP session, never a title or a scan
for all Chrome processes. No unrelated browser, page or application is touched.
"""
import ctypes
import sys
import threading
from ctypes import wintypes


class WindowsChrome:
    def __init__(self, pid):
        if not isinstance(pid, int) or pid <= 0:raise ValueError('Missing browser process identity.')
        self.pid=pid;self.user=ctypes.WinDLL('user32',use_last_error=True)
        self.callback=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
        self.user.EnumWindows.argtypes=[self.callback,wintypes.LPARAM]
        self.user.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
        self.user.GetClassNameW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
        for name in ('IsWindowVisible','IsIconic','SetForegroundWindow'):
            getattr(self.user,name).argtypes=[wintypes.HWND]
        self.user.ShowWindow.argtypes=[wintypes.HWND,ctypes.c_int]

    def windows(self):
        found=[]
        @self.callback
        def collect(hwnd,_):
            pid=wintypes.DWORD();self.user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
            if pid.value==self.pid:
                name=ctypes.create_unicode_buffer(100);self.user.GetClassNameW(hwnd,name,len(name))
                if name.value=='Chrome_WidgetWin_1':found.append(hwnd)
            return True
        if not self.user.EnumWindows(collect,0):raise OSError('Cannot locate the runner browser window.')
        return found

    def hide(self):
        for hwnd in self.windows():self.user.ShowWindow(hwnd,0)  # SW_HIDE, not minimized.

    def show(self):
        windows=self.windows()
        if not windows:raise OSError('The filled browser window is unavailable.')
        for hwnd in windows:
            self.user.ShowWindow(hwnd,9)  # SW_RESTORE, only after an owner command.
            self.user.SetForegroundWindow(hwnd)
        if not all(self.user.IsWindowVisible(h) and not self.user.IsIconic(h) for h in windows):
            raise OSError('The filled browser could not be shown.')


class BrowserVisibility:
    def __init__(self, native):
        self.native=native;self.hidden=True;self.lock=threading.Lock();self.stop=threading.Event();self.error=None
        self.thread=threading.Thread(target=self._guard,name='CyberApply hidden browser',daemon=True)
        self.thread.start()

    @classmethod
    def attach(cls,browser,context):
        if sys.platform!='win32':return None
        session=browser.new_browser_cdp_session()
        try:
            processes=session.send('SystemInfo.getProcessInfo')['processInfo']
            pids=[int(p['id']) for p in processes if p.get('type')=='browser']
            if len(pids)!=1:raise OSError('Cannot identify the runner browser process.')
        finally:session.detach()
        control=cls(WindowsChrome(pids[0]));context._cyberapply_visibility=control
        return control

    def _guard(self):
        while not self.stop.is_set():
            with self.lock:
                if self.hidden:
                    try:self.native.hide()
                    except Exception:self.error='Background browser visibility is unavailable.'
            self.stop.wait(.05)

    def hide(self):
        with self.lock:
            self.hidden=True;self.native.hide()
            if self.error:raise OSError(self.error)

    def show(self):
        with self.lock:
            if self.error:raise OSError(self.error)
            self.hidden=False
            try:self.native.show()
            except Exception:
                self.hidden=True;self.native.hide();raise

    def close(self):
        self.stop.set();self.thread.join(timeout=2)
