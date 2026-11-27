"""Bounded independent application workers; stopping drains existing browsers."""
from concurrent.futures import ThreadPoolExecutor
import threading
import time
from urllib.error import HTTPError, URLError

MAX_PARALLEL_APPLICATIONS = 10


def run_pool(work, stopping, publish, *, limit=MAX_PARALLEL_APPLICATIONS,
             maintenance=None, interval=5, wait=time.sleep, clock=time.monotonic):
    if not 1 <= limit <= MAX_PARALLEL_APPLICATIONS:
        raise ValueError('Invalid parallel application limit.')
    states = {}
    lock = threading.Lock()
    pending = {}
    next_check = 0
    sequence = failures = 0
    last_result = None
    idle_state = 'checking'
    needs_maintenance = False

    def update(key, value):
        with lock:
            states[key] = value

    # Each task creates and uses its own Playwright runtime on its own thread.
    # Futures are never cancelled: a manual browser remains alive until resolved.
    with ThreadPoolExecutor(max_workers=limit, thread_name_prefix='CyberApply job') as pool:
        while True:
            for future, key in list(pending.items()):
                if not future.done():
                    continue
                del pending[future]
                with lock:
                    states.pop(key, None)
                try:
                    worked = future.result()
                    failures = 0
                    idle_state = 'running'
                    last_result = 'processed_request' if worked else 'queue_empty'
                    needs_maintenance = needs_maintenance or not worked
                except Exception as error:
                    failures += 1
                    if isinstance(error, HTTPError) and error.code in (401, 403):
                        idle_state, delay = 'reconnect_required', 60
                    else:
                        idle_state = 'waiting_for_connection' if isinstance(error, (HTTPError, URLError, OSError)) else 'needs_review'
                        delay = min(300, 5 * 2 ** min(failures, 6))
                    next_check = max(next_check, clock() + delay)
            drain = stopping()
            if not drain and clock() >= next_check:
                while len(pending) < limit:
                    sequence += 1
                    key = sequence
                    update(key, 'checking')
                    future = pool.submit(work, lambda state, key=key: update(key, state))
                    pending[future] = key
                next_check = clock() + interval
            with lock:
                active = sum(value == 'working' for value in states.values())
            state = 'working' if active else 'checking' if pending else 'stopped' if drain else idle_state
            try:
                publish(state, activeApplications=active, parallelSlots=limit,
                        draining=drain, **({'last_result': last_result} if last_result else {}))
            except OSError:
                pass  # A local status reader must not interrupt an employer form.
            if drain and not pending:
                return
            if not pending and needs_maintenance and idle_state == 'running' and maintenance and not drain:
                needs_maintenance = False
                try:
                    maintenance()
                except Exception:
                    pass  # Maintenance never replays a form or its outcome POST.
            wait(.5)
