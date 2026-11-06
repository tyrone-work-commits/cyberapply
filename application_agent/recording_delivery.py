"""Durable owner-bound media outbox. Never queues or submits applications."""
import hashlib,json,os,shutil,threading,time
from pathlib import Path
from urllib.error import HTTPError
from uuid import uuid4

LOCK=threading.Lock()
UPLOAD_LOCK=threading.Lock()
ACTIVE=set()
MAX_PENDING_BYTES=256_000_000

def outbox(site,token):
    owner=token.split('.')[1]
    namespace=hashlib.sha256((site+'|'+owner).encode()).hexdigest()
    folder=Path(os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_DATA_HOME') or Path.home()/'.local/share')/'CyberApply'/'application-agent'/'recordings'/namespace
    folder.mkdir(parents=True,exist_ok=True)
    return folder

def write(path,value):
    pending=path.with_suffix('.new');pending.write_text(json.dumps(value),encoding='utf-8')
    for attempt in range(8):
        try:pending.replace(path);break
        except PermissionError:
            if attempt==7:raise
            time.sleep(min(.02*2**attempt,.25))

def session_path(folder,task):
    return folder/(hashlib.sha256((task['requestId']+'|'+task['claimId']).encode()).hexdigest()+'.session.json')

def media_path(folder,name):
    if not isinstance(name,str) or len(name)!=36 or not name.endswith('.mp4') or any(c not in '0123456789abcdef' for c in name[:-4]):raise ValueError('Invalid private media path.')
    path=folder/name
    if path.is_symlink() or path.resolve().parent!=folder.resolve():raise ValueError('Invalid private media path.')
    return path

def flush_pending(site,token,service=None,limit=3):
    """Retries media only, including after a worker restart. Credentials stay in memory."""
    from .runner import upload_recording,call_site
    if not UPLOAD_LOCK.acquire(blocking=False):return
    try:
        folder=outbox(site,token)
        for entry in sorted(folder.glob('*.media.json'),key=lambda p:p.stat().st_mtime)[:limit]:
            value=json.loads(entry.read_text(encoding='utf-8'))
            path=media_path(folder,value['file'])
            if not path.exists():
                if time.time()-entry.stat().st_mtime>60:entry.unlink(missing_ok=True)
                continue
            if value.get('nextTry',0)>time.time():continue
            info={**value['info'],'path':path}
            try:
                upload_recording(site,token,value['task'],info,service)
            except Exception as error:
                # A deleted/revoked destination is never recreated to save a video.
                if isinstance(error,HTTPError) and error.code in (404,410):
                    path.unlink(missing_ok=True);entry.unlink(missing_ok=True);continue
                value['attempts']=value.get('attempts',0)+1
                value['nextTry']=time.time()+min(300,5*2**min(value['attempts'],6))
                value['error']='http_'+str(error.code) if isinstance(error,HTTPError) else 'connection_or_upload_failed'
                write(entry,value)
            else:
                path.unlink(missing_ok=True);entry.unlink(missing_ok=True)
        for entry in folder.glob('*.session.json'):
            value=json.loads(entry.read_text(encoding='utf-8'))
            active=str(entry) in ACTIVE
            pending=[json.loads(p.read_text(encoding='utf-8')) for p in folder.glob('*.media.json')]
            pending=[p for p in pending if p['task']==value['task']]
            if not active and not pending and value.get('published')==value.get('version') and (value.get('finished') or value.get('publishedState')=='interrupted'):continue
            if time.time()-value.get('lastPublish',0)<10:continue
            state='upload_pending' if pending else 'capturing' if active and not value.get('finished') else 'saved' if value.get('parts') else 'failed'
            code=value.get('code','')
            if not active and not value.get('finished'):state='interrupted';code='runner_interrupted'
            if pending and any(p.get('error') for p in pending):code='upload_retrying'
            body={**value['task'],'state':state,'code':code,'parts':value.get('parts',0),'partial':bool(value.get('code')) or state=='interrupted'}
            try:call_site(site,token,'/api/application-agent/recording-status',body,site_access_token=service,timeout=8)
            except HTTPError as error:
                if error.code in (404,410):entry.unlink(missing_ok=True)
                continue
            except Exception:continue
            with LOCK:
                latest=json.loads(entry.read_text(encoding='utf-8'));latest['published']=value['version'];latest['publishedState']=state;latest['lastPublish']=time.time();write(entry,latest)
    finally:UPLOAD_LOCK.release()

class RecordingDelivery:
    def __init__(self,site,token,task,service=None):
        self.site=site;self.token=token;self.task={k:task[k] for k in ('requestId','claimId')};self.service=service
        self.folder=outbox(site,token);self.path=session_path(self.folder,self.task);self.stop=threading.Event();self.capture=None;self.marked=False
        with LOCK:
            write(self.path,{'task':self.task,'version':1,'parts':0,'finished':False,'code':''});ACTIVE.add(str(self.path))
        self.thread=threading.Thread(target=self._pump,name='CyberApply recording recovery',daemon=True);self.thread.start()
    def _pump(self):
        while not self.stop.is_set():
            try:
                if self.capture and not self.capture.thread.is_alive() and not self.marked:self.mark_finished(self.capture)
                flush_pending(self.site,self.token,self.service)
                if self.marked:
                    value=json.loads(self.path.read_text(encoding='utf-8'))
                    if value.get('published')==value.get('version') and not any(json.loads(p.read_text(encoding='utf-8'))['task']==self.task for p in self.folder.glob('*.media.json')):return
            except Exception:pass
            self.stop.wait(2)
    def part(self,info):
        with LOCK:
            if sum(p.stat().st_size for p in self.folder.glob('*.mp4'))+info['path'].stat().st_size>MAX_PENDING_BYTES:raise OSError('Private recording outbox is full.')
            name=uuid4().hex+'.mp4';destination=media_path(self.folder,name)
            write(self.folder/(name[:-4]+'.media.json'),{'task':self.task,'file':name,'info':{k:v for k,v in info.items() if k!='path'}})
            shutil.move(str(info['path']),destination)
            value=json.loads(self.path.read_text(encoding='utf-8'));value['parts']+=1;value['version']+=1;write(self.path,value)
    def observe(self,recording):
        self.capture=recording
    def mark_finished(self,recording=None):
        with LOCK:
            value=json.loads(self.path.read_text(encoding='utf-8'));value['finished']=True;value['version']+=1
            value['code']=('recording_limit' if recording and recording.reason=='recording_limit' else 'capture_interrupted' if recording and recording.error else 'no_frames' if not value['parts'] else '')
            value['lastPublish']=0;write(self.path,value);ACTIVE.discard(str(self.path));self.marked=True
    def finish(self,recording=None):
        if not self.marked:self.mark_finished(recording)
        self.stop.set();self.thread.join(timeout=.2)
        # The next normal background check flushes anything still offline.
        try:flush_pending(self.site,self.token,self.service)
        except Exception:pass
