"""Recover only server-verified, never-exposed unsent forms after restart/sign-in.

No browser control, credential storage, Submit, or employer request is performed
here. Sleep does not create a new runner instance; the surviving form stays alive.
"""
import ctypes
from datetime import datetime, timezone
import sys
import threading
import time
from urllib.error import HTTPError


def computer_boot_at():
    if sys.platform != 'win32':
        return None
    try:
        uptime = ctypes.windll.kernel32.GetTickCount64
        uptime.argtypes = []
        uptime.restype = ctypes.c_ulonglong
        return datetime.fromtimestamp(time.time() - uptime() / 1000, timezone.utc).isoformat()
    except (AttributeError, OSError, ValueError, OverflowError):
        return None  # Ordinary authorized work must still function without boot evidence.


class RestartRecovery:
    def __init__(self, call, boot_at=None, clock=time.monotonic):
        self.call = call
        self.boot_at = computer_boot_at() if boot_at is None else boot_at
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.clock = clock
        self.next_check = 0
        self.lock = threading.Lock()

    def check(self, site, token, service=None):
        if not self.boot_at or not self.lock.acquire(blocking=False):
            return
        try:
            if self.clock() < self.next_check:
                return
            self.next_check = self.clock() + 30
            try:
                self.call(site, token, '/api/application-agent/restart-recovery',
                          {'version': 1, 'computerBootAt': self.boot_at, 'runnerStartedAt': self.started_at},
                          site_access_token=service, timeout=8)
            except HTTPError as error:
                if error.code == 404:
                    self.next_check = self.clock() + 300
            except Exception:
                pass  # A failed check never queues, replays or interrupts a form.
        finally:
            self.lock.release()
