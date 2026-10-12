"""Track live I/O and renew durable worker leases while an adapter runs."""
from contextlib import contextmanager
from threading import Event, Lock, Thread

_active = {}
_lock = Lock()


def user_has_live_io(user_id):
    with _lock:
        return _active.get(user_id, 0) > 0


@contextmanager
def live_io(user_id, heartbeat=None, interval=10):
    stopped = Event()
    with _lock:
        _active[user_id] = _active.get(user_id, 0) + 1
    def renew():
        while not stopped.wait(interval):
            try:
                heartbeat()
            except Exception:
                # A storage outage must not imply that in-flight I/O has ended.
                continue
    thread = Thread(target=renew, daemon=True) if heartbeat else None
    if thread:
        thread.start()
    try:
        yield
    finally:
        stopped.set()
        if thread:
            thread.join(timeout=1)
        with _lock:
            _active[user_id] -= 1
            if not _active[user_id]:
                del _active[user_id]
