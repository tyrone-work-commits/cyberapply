"""Native Windows alerts with system sound. Persistent owner/event dedup; no employer actions."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

APP_URL='https://cyberapply-internal.covenda-1182.chatgpt.site/workspace?view=applications'

def show_notices(items):
    if sys.platform!='win32':return set()
    try:
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',str(Path(__file__).with_name('windows_notifications.ps1'))],
          input=json.dumps({'url':APP_URL,'items':items}),text=True,encoding='utf-8',capture_output=True,timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        reply=json.loads(result.stdout) if result.returncode==0 else {}
        return set(reply.get('sent',[]))
    except Exception:return set()

def show_notice(kind,body,tag):
    return tag in show_notices([{'kind':kind,'body':body,'tag':tag}])

class DesktopNotifications:
    def __init__(self,folder,send=show_notices,clock=time.time):
        self.folder=Path(folder);self.send=send;self.clock=clock;self.lock=threading.Lock()

    def deliver(self,site,connection,notices):
        """Only fresh authenticated heartbeat metadata is accepted by the caller."""
        from .runner import parse_connection
        if not connection or not isinstance(notices,list):return
        token,_=parse_connection(connection,site)
        namespace=hashlib.sha256((site+'|'+token.split('.')[1]).encode()).hexdigest()
        folder=self.folder/'notifications'/namespace;path=folder/'events.json'
        with self.lock:
            folder.mkdir(parents=True,exist_ok=True)
            try:
                value=json.loads(path.read_text(encoding='utf-8'))
                events={key:{k:row[k] for k in ('sentAt','retryAt') if isinstance(row.get(k),(int,float)) and math.isfinite(row[k])} for key,row in value.items() if isinstance(key,str) and re.fullmatch(r'[a-f0-9]{64}',key) and isinstance(row,dict) and any(isinstance(row.get(k),(int,float)) and math.isfinite(row[k]) for k in ('sentAt','retryAt'))} if isinstance(value,dict) and len(value)<=512 else {}
            except (OSError,ValueError):events={}
            now=self.clock();pending=[];keys={}
            for notice in notices[:100]:
                if not isinstance(notice,dict) or notice.get('kind') not in {'input','submit'}:continue
                key=notice.get('key');company=notice.get('company','Employer');role=notice.get('role','Job application')
                if not isinstance(key,str) or not 1<=len(key)<=1000 or not isinstance(company,str) or not isinstance(role,str):continue
                digest=hashlib.sha256(key.encode()).hexdigest();previous=events.get(digest,{})
                if not isinstance(previous,dict):previous={}
                if previous.get('sentAt') is not None or previous.get('retryAt',0)>now or digest in keys.values():continue
                title=re.sub(r'[\s\x00-\x1f]+',' ',f'{company[:120]} — {role[:180]}').strip()
                action='Open Applications to review the employer questions.' if notice['kind']=='input' else 'Open Applications, then open your prepared browser and press Submit.'
                tag=digest[:16];keys[tag]=digest;pending.append({'kind':notice['kind'],'body':title[:220]+'. '+action,'tag':tag})
                if len(pending)==10:break
            if not pending:return
            try:sent=self.send(pending) or set()
            except Exception:sent=set()
            for item in pending:
                events[keys[item['tag']]]={'sentAt':now} if item['tag'] in sent else {'retryAt':now+300}
            events=dict(sorted(events.items(),key=lambda pair:max(pair[1].get('sentAt',0),pair[1].get('retryAt',0)),reverse=True)[:512])
            # No CV, answers, credentials, titles or employer URLs are persisted.
            temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(events),encoding='utf-8');temporary.replace(path)
