"""Single-use Greenhouse attachment tickets. No general storage-host permission.

Tickets, signatures and multipart bodies stay in memory and out of reports.
An attachment upload is not evidence of a submitted application.
"""
from __future__ import annotations
import base64
import json
import re
import time
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from urllib.parse import urlsplit, parse_qsl

UPLOAD_HOST = 'grnhse-prod-jben-us-east-1.s3.amazonaws.com'
BOARD_HOSTS = {'boards.greenhouse.io','job-boards.greenhouse.io','boards-api.greenhouse.io'}
TICKET_FIELDS = {'x-amz-server-side-encryption','success_action_status','policy','x-amz-credential','x-amz-algorithm','x-amz-date','x-amz-signature'}


def ticket_request(url, method, kind):
    try:
        u=urlsplit(url);pairs=parse_qsl(u.query,keep_blank_values=True,strict_parsing=True)
        return bool(u.scheme=='https' and u.hostname in BOARD_HOSTS and u.port in (None,443)
            and not u.username and not u.password and not u.fragment
            and u.path=='/uncacheable_attributes/presigned_fields' and method=='GET' and kind in {'fetch','xhr'}
            and 0<len(pairs)<=2 and all(k=='fields[]' and v in {'resume','cover_letter'} for k,v in pairs)
            and len(set(v for _,v in pairs))==len(pairs))
    except (TypeError,ValueError):return False


def storage_url(url):
    try:
        u=urlsplit(url)
        return bool(u.scheme=='https' and u.hostname==UPLOAD_HOST and u.port in (None,443)
            and not u.username and not u.password and not u.query and not u.fragment and u.path in {'','/'})
    except (TypeError,ValueError):return False


class UploadRejected(Exception):pass


class GreenhouseUploads:
    def __init__(self,enabled,report,clock=time.time):
        self.enabled,self.report,self.clock=enabled,report,clock
        self.tickets={};self.materials={};self.attempts={};self.requests={};self.outcomes={}

    def observe_ticket(self,response):
        req=response.request
        if not self.enabled or not ticket_request(req.url,req.method,req.resource_type) or response.status!=200 or req.redirected_from:return
        try:
            raw=response.body()
            if len(raw)>64000:return
            data=json.loads(raw)
            if not isinstance(data,dict):return
            if not storage_url(data.get('url','')):return
            for field in ('resume','cover_letter'):
                item=data.get(field)
                if not isinstance(item,dict) or field in self.attempts:continue
                f=item.get('fields');key=item.get('key','')
                if not isinstance(f,dict) or set(f)!=TICKET_FIELDS or not all(isinstance(v,str) and len(v)<=16000 for v in f.values()):continue
                if not re.fullmatch(r'stash/applications/resumes/\{timestamp\}-\{unique_id\}-[a-f0-9]{32}',key):continue
                if f['x-amz-server-side-encryption']!='AES256' or f['success_action_status']!='201' or f['x-amz-algorithm']!='AWS4-HMAC-SHA256':continue
                if not re.fullmatch(r'[a-f0-9]{64}',f['x-amz-signature']):continue
                policy=json.loads(base64.b64decode(f['policy'],validate=True))
                expiry=datetime.fromisoformat(policy['expiration'].replace('Z','+00:00')).timestamp()
                if not self.clock()<expiry<=self.clock()+40*86400:continue
                conditions=policy['conditions']
                exact={k:v for c in conditions if isinstance(c,dict) for k,v in c.items()}
                if exact.get('bucket')!='grnhse-prod-jben-us-east-1':continue
                if any(exact.get(k)!=f[k] for k in TICKET_FIELDS-{'policy','x-amz-signature'}):continue
                if ['starts-with','$key','stash/applications/resumes'] not in conditions:continue
                limits=[c for c in conditions if isinstance(c,list) and len(c)==3 and c[0]=='content-length-range']
                if len(limits)!=1 or not isinstance(limits[0][1],int) or not isinstance(limits[0][2],int) or not 1<=limits[0][1]<=limits[0][2]<=104857600:continue
                self.tickets[field]={'fields':dict(f),'key':key,'expires':expiry,'max':limits[0][2]}
        except (KeyError,TypeError,ValueError,OverflowError):return

    def arm(self,field,name,mime,content):
        if self.enabled:self.materials[field]={'name':name,'mime':mime,'bytes':content}

    def permit_preflight(self,request,authorized):
        """XHR upload progress listeners trigger a CORS preflight with no file."""
        try:
            origin=urlsplit(request.headers.get('origin',''))
            valid_origin=(origin.scheme=='https' and origin.hostname in BOARD_HOSTS and origin.port in (None,443)
                and not origin.username and not origin.password and origin.path in {'','/'} and not origin.query and not origin.fragment)
            fresh=any(field in self.materials and field not in self.attempts and ticket['expires']>self.clock() for field,ticket in self.tickets.items())
            if (self.enabled and storage_url(request.url) and request.method=='OPTIONS' and not request.redirected_from
                    and request.resource_type in {'other','fetch','xhr'} and valid_origin and fresh
                    and request.headers.get('access-control-request-method')=='POST'
                    and request.headers.get('access-control-request-headers','').lower() in {'','content-type'}
                    and not request.post_data_buffer and not any(k in request.headers for k in ('cookie','authorization'))
                    and authorized() is True):return
        except (TypeError,ValueError):pass
        raise UploadRejected('The attachment preflight did not match the supported employer upload.')

    def permit(self,request,authorized):
        """Validate the exact one-file multipart POST before any bytes leave."""
        if not self.enabled or not storage_url(request.url) or request.resource_type not in {'fetch','xhr'} or request.redirected_from:
            raise UploadRejected('The attachment destination does not match the supported upload service.')
        if request.method!='POST':raise UploadRejected('Only the signed attachment POST is supported.')
        if authorized() is not True:raise UploadRejected('Attachment upload no longer has current authorization.')
        if (urlsplit(request.frame.url).hostname or '') not in BOARD_HOSTS:raise UploadRejected('The upload was not requested by the supported employer form.')
        if any(k in request.headers for k in ('cookie','authorization')):raise UploadRejected('Storage uploads cannot send browser credentials.')
        body=request.post_data_buffer or b'';content_type=request.headers.get('content-type','')
        if len(body)>15_100_000 or not re.fullmatch(r'multipart/form-data;\s*boundary=[A-Za-z0-9\-]{1,150}',content_type):
            raise UploadRejected('The attachment multipart format is unsupported.')
        message=BytesParser(policy=default).parsebytes(('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body)
        parts=list(message.iter_parts())
        if message.defects or len(parts)!=12:raise UploadRejected('The attachment contains unexpected multipart fields.')
        fields={};file=None
        for part in parts:
            name=part.get_param('name',header='content-disposition')
            if part.is_multipart() or part.defects or part.get_content_disposition()!='form-data' or not name:
                raise UploadRejected('The attachment multipart fields are invalid.')
            raw=part.get_payload(decode=True)
            if name=='file':
                if file is not None:raise UploadRejected('Only one selected attachment may be uploaded.')
                file=(part.get_filename(),part.get_content_type(),raw)
            else:
                if name in fields or part.get_filename() is not None or len(raw)>16000:raise UploadRejected('Duplicate or oversized attachment fields were blocked.')
                try:fields[name]=raw.decode('utf-8')
                except UnicodeDecodeError:raise UploadRejected('The upload fields are not valid text.') from None
        if not file:raise UploadRejected('The selected attachment is missing.')
        for field,ticket in self.tickets.items():
            material=self.materials.get(field)
            if not material or field in self.attempts or ticket['expires']<=self.clock():continue
            required={**ticket['fields'],'utf8':'✓','authenticity_token':'1234','Content-Type':'application/octet-stream'}
            if set(fields)!=set(required)|{'key'} or any(fields.get(k)!=v for k,v in required.items()):continue
            pattern=re.escape(ticket['key']).replace(re.escape('{timestamp}'),r'(\d{13})').replace(re.escape('{unique_id}'),r'[a-z0-9]{1,14}')
            match=re.fullmatch(pattern,fields.get('key',''))
            if not match or abs(int(match[1])/1000-self.clock())>600:continue
            if file[0]!=material['name'] or file[1]!=material['mime'] or len(file[2])>ticket['max'] or file[2]!=material['bytes']:continue
            self.attempts[field]=True;self.requests[request]=field;self.outcomes[field]='pending'
            self._report()
            return field
        raise UploadRejected('The upload did not match a fresh employer ticket and the exact selected attachment, or it was already attempted.')

    def observe_upload(self,response):
        field=self.requests.get(response.request)
        if field:
            self.outcomes[field]='accepted' if response.status==201 else 'failed'
            self._report()

    def _report(self):
        self.report['attachment_uploads']=[{'attachment':field,'status':state,'attempts':1} for field,state in self.outcomes.items()]

    def settle(self,page,timeout):
        expected=set(self.tickets)&set(self.materials)
        if not expected:return
        deadline=time.monotonic()+timeout/1000
        while time.monotonic()<deadline and any(self.outcomes.get(f) not in {'accepted','failed'} for f in expected):page.wait_for_timeout(100)
        if any(self.outcomes.get(f)!='accepted' for f in expected):
            raise UploadRejected('The employer attachment upload was not confirmed. It was not replayed and Submit was not clicked.')
