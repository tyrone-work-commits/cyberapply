"""Small authenticated background check-ins; never logs the connection bundle."""
import json
import os
import threading
from .runner import call_site, parse_connection
from .secure_storage import protect

ALLOWED={'checking','running','working','reconnect_required','waiting_for_connection','needs_review','stopped'}

def publish(folder,site,state,connection=None):
    if state not in ALLOWED:raise ValueError('Unknown runner state.')
    raw=connection if connection is not None else protect((folder/'connection.dat').read_bytes(),decrypt=True).decode('utf-8')
    token,service=parse_connection(raw,site)
    call_site(site,token,'/api/application-agent/heartbeat',{'state':state},site_access_token=service,timeout=8)

def start(folder,site,interval=20,get_connection=None):
    stopped=threading.Event()
    def loop():
        while not stopped.is_set():
            try:
                local=json.loads((folder/'status.json').read_text(encoding='utf-8'))
                connection=get_connection() if get_connection else None
                if local.get('pid')==os.getpid() and (not get_connection or connection is not None):publish(folder,site,local['state'],connection=connection)
            except Exception:pass  # Offline check-ins must never replay or interrupt a form.
            stopped.wait(interval)
    thread=threading.Thread(target=loop,name='CyberApply presence',daemon=True)
    stopped.thread=thread
    thread.start()
    return stopped

def stop(monitor):
    monitor.set()
    monitor.thread.join(timeout=10)
