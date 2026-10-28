"""Encrypted sessions partitioned by CyberApply owner and employer."""
import hashlib
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit,parse_qs
from .secure_storage import protect

MAX_AGE=14*86400


def employer_partition(job):
    url=urlsplit(job.get('applyUrl') or job.get('url') or '')
    host=(url.hostname or '').lower().rstrip('.')
    parts=[p for p in url.path.split('/') if p]
    # Shared ATS hosts must not share one employer's account with another.
    tenant=''
    if host.endswith('.greenhouse.io'):
        if parts and parts[0]=='embed':
            query=parse_qs(url.query)
            tenant=(query.get('for') or query.get('board_token') or [hashlib.sha256(url.geturl().encode()).hexdigest()])[0]
        elif len(parts)>2 and parts[1]=='boards':tenant=parts[2]
        else:tenant=parts[0] if parts else hashlib.sha256(url.geturl().encode()).hexdigest()
        if host in {'boards.greenhouse.io','job-boards.greenhouse.io','boards-api.greenhouse.io'}:host='greenhouse.global'
        elif host in {'boards.eu.greenhouse.io','job-boards.eu.greenhouse.io','boards-api.eu.greenhouse.io'}:host='greenhouse.eu'
    elif host.endswith('.lever.co'):
        tenant=parts[2] if len(parts)>2 and parts[1]=='postings' else parts[0] if parts else hashlib.sha256(url.geturl().encode()).hexdigest()
        if host in {'jobs.lever.co','api.lever.co'}:host='lever.global'
        elif host in {'jobs.eu.lever.co','api.eu.lever.co'}:host='lever.eu'
    return host+'/'+tenant


def scoped_state(state,hosts):
    if not isinstance(state,dict):
        raise ValueError('Invalid browser session.')
    cookies=[]
    for cookie in state.get('cookies',[]):
        if not isinstance(cookie,dict):continue
        domain=str(cookie.get('domain','')).lstrip('.').lower()
        if domain and any(host==domain or host.endswith('.'+domain) for host in hosts) and domain.count('.')>=1:
            cookies.append(cookie)
    origins=[]
    for origin in state.get('origins',[]):
        if not isinstance(origin,dict):continue
        parsed=urlsplit(str(origin.get('origin','')))
        if parsed.scheme=='https' and parsed.hostname in hosts and parsed.port in (None,443) and not parsed.username and not parsed.password:
            origins.append(origin)
    return {'cookies':cookies,'origins':origins}


class LoginSessions:
    def __init__(self,site,owner,root=None,clock=time.time):
        self.root=Path(root) if root is not None else Path(os.environ['LOCALAPPDATA'])/'CyberApply'/'application-agent'/'sessions'
        self.owner=hashlib.sha256((site+'\0'+owner).encode()).hexdigest()
        self.clock=clock

    def path(self,job):
        return self.root/self.owner/(hashlib.sha256(employer_partition(job).encode()).hexdigest()+'.dat')

    def load(self,job,hosts):
        path=self.path(job)
        if not path.is_file():
            return None
        try:
            packet=json.loads(protect(path.read_bytes(),decrypt=True))
            age=self.clock()-packet['at']
            if age<0 or age>MAX_AGE:
                path.unlink(missing_ok=True)
                return None
            return scoped_state(packet['state'],hosts)
        except (OSError,ValueError,KeyError,TypeError):
            return None

    def save(self,job,hosts,state,refresh=False):
        path=self.path(job)
        created=self.clock()
        if refresh:
            try:created=json.loads(protect(path.read_bytes(),decrypt=True))['at']
            except (OSError,ValueError,KeyError,TypeError):return
        payload=json.dumps({'at':created,'state':scoped_state(state,hosts)}).encode()
        if len(payload)>2_000_000:
            raise ValueError('Browser session exceeded the encrypted storage limit.')
        path.parent.mkdir(parents=True,exist_ok=True)
        pending=path.with_suffix('.new')
        pending.write_bytes(protect(payload))
        pending.replace(path)

    def clear(self):
        folder=self.root/self.owner
        if folder.exists():
            for path in folder.glob('*.dat'):
                path.unlink()
