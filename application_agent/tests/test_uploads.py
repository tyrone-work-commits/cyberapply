import base64
from datetime import datetime,timezone,timedelta
import json
from types import SimpleNamespace

import pytest

from application_agent.uploads import GreenhouseUploads,UploadRejected,UPLOAD_HOST,ticket_request,storage_url
from application_agent.tests.test_browser import CV,PAYLOAD,FORM,run
from application_agent.tests.test_static_assets import JOB

TICKET='https://boards.greenhouse.io/uncacheable_attributes/presigned_fields?fields%5B%5D=resume'
STORAGE=f'https://{UPLOAD_HOST}'


def ticket():
    fields={'x-amz-server-side-encryption':'AES256','success_action_status':'201','x-amz-credential':'FIXTURE/20261030/us-east-1/s3/aws4_request','x-amz-algorithm':'AWS4-HMAC-SHA256','x-amz-date':'20261030T171731Z','x-amz-signature':'a'*64}
    policy={'expiration':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),'conditions':[{'bucket':'grnhse-prod-jben-us-east-1'},['starts-with','$key','stash/applications/resumes'],['content-length-range',1,104857600],*[{k:v} for k,v in fields.items() if k!='x-amz-signature']]}
    fields['policy']=base64.b64encode(json.dumps(policy).encode()).decode()
    return {'url':STORAGE,'resume':{'fields':fields,'key':'stash/applications/resumes/{timestamp}-{unique_id}-'+'a'*32}}


def ready(data=None):
    import time
    data=data or ticket();report={};agent=GreenhouseUploads(True,report)
    agent.observe_ticket(SimpleNamespace(request=SimpleNamespace(url=TICKET,method='GET',resource_type='fetch',redirected_from=None),status=200,body=lambda:json.dumps(data).encode()))
    agent.arm('resume','chosen.pdf','application/pdf',CV)
    values={**data['resume']['fields'],'utf8':'✓','authenticity_token':'1234','Content-Type':'application/octet-stream','key':data['resume']['key'].replace('{timestamp}',str(int(time.time()*1000))).replace('{unique_id}','abc123')}
    return agent,report,values


def request(values,content=CV,filename='chosen.pdf',url=STORAGE,method='POST',extra=b''):
    boundary='fixture-boundary';body=b''
    for key,value in values.items():body+=f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    body+=f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: application/pdf\r\n\r\n'.encode()+content+b'\r\n'+extra+f'--{boundary}--\r\n'.encode()
    class Request:pass
    req=Request();req.url=url;req.method=method;req.resource_type='xhr';req.redirected_from=None;req.frame=SimpleNamespace(url=JOB['url']);req.headers={'content-type':f'multipart/form-data; boundary={boundary}'};req.post_data_buffer=body
    return req


def test_exact_ticket_and_selected_cv_allowed_once_without_leaking_report():
    agent,report,values=ready();req=request(values)
    assert agent.permit(req,lambda:True)=='resume'
    agent.observe_upload(SimpleNamespace(request=req,status=201))
    assert report=={'attachment_uploads':[{'attachment':'resume','status':'accepted','attempts':1}]}
    assert 'policy' not in json.dumps(report) and CV.decode() not in json.dumps(report)
    with pytest.raises(UploadRejected):agent.permit(req,lambda:True)


@pytest.mark.parametrize('change',['bytes','filename','key','signature','extra','expired','revoked','redirect','credentials','wrong_frame','GET','navigation','host','policy'])
def test_upload_boundary_rejects_unselected_or_unapproved_data(change):
    agent,report,values=ready();auth=lambda:True
    if change in {'key','signature','policy'}:values[{'signature':'x-amz-signature'}.get(change,change)]='tampered'
    if change=='extra':values['private_answer']='not-an-attachment'
    if change=='expired':agent.tickets['resume']['expires']=0
    if change=='revoked':auth=lambda:False
    req=request(values,content=b'other CV' if change=='bytes' else CV,filename='wrong.pdf' if change=='filename' else 'chosen.pdf')
    if change=='redirect':req.redirected_from=object()
    if change=='credentials':req.headers['authorization']='secret'
    if change=='wrong_frame':req.frame.url='https://unrelated.example/'
    if change=='GET':req.method='GET'
    if change=='navigation':req.resource_type='document'
    if change=='host':req.url=STORAGE+'.evil.example'
    with pytest.raises(UploadRejected):agent.permit(req,auth)
    assert not report


def test_ticket_scope_and_storage_url_are_exact():
    assert ticket_request(TICKET,'GET','fetch') and storage_url(STORAGE)
    for url in [TICKET+'&cv=private',TICKET.replace('resume','other'),TICKET.replace('boards.greenhouse.io','boards.greenhouse.io.evil.example')]:assert not ticket_request(url,'GET','fetch')
    for url in [STORAGE+'/object',STORAGE+'?secret=1',STORAGE.replace('https:','http:'),STORAGE+'.evil.example']:assert not storage_url(url)


def test_progress_upload_preflight_has_no_attachment_or_general_host_permission():
    agent,report,values=ready();req=request(values,method='OPTIONS');req.post_data_buffer=None
    req.resource_type='other';req.headers={'origin':'https://job-boards.greenhouse.io','access-control-request-method':'POST'}
    agent.permit_preflight(req,lambda:True)
    assert not agent.attempts and not report
    for key,value in [('origin','https://evil.example'),('access-control-request-method','PUT'),('access-control-request-headers','authorization')]:
        previous=req.headers.get(key);req.headers[key]=value
        with pytest.raises(UploadRejected):agent.permit_preflight(req,lambda:True)
        if previous is None:del req.headers[key]
        else:req.headers[key]=previous
    with pytest.raises(UploadRejected):agent.permit_preflight(req,lambda:False)


def remote_upload_form(data):
    script='''<script>
    const ticket=fetch(TICKET).then(r=>r.json());
    document.querySelector('input[type=file]').onchange=async e=>{
      const t=await ticket,f=t.resume,d=new FormData();d.append('utf8','✓');
      Object.entries(f.fields).forEach(([k,v])=>d.append(k,v));
      d.append('key',f.key.replace('{timestamp}',String(Date.now())).replace('{unique_id}','abc123'));
      d.append('authenticity_token','1234');d.append('Content-Type','application/octet-stream');d.append('file',e.target.files[0]);
      await fetch(t.url,{method:'POST',body:d});
    };
    </script>'''.replace('fetch(TICKET)',f'fetch({json.dumps(TICKET)})')
    return FORM.replace('<html>','<html><head><meta charset="utf-8"></head>').replace('{extra}',script)


def test_background_worker_uploads_exact_cv_then_submits_once_with_receipt():
    data=ticket();form=remote_upload_form(data);seen=[]
    def employer(req):
        seen.append((req.url,req.method))
        if req.url==TICKET:return {'body':json.dumps(data),'content_type':'application/json'}
        if req.url==STORAGE+'/':return {'body':'<PostResponse/>','content_type':'application/xml','status':201}
        if req.method=='POST':return 'Your application has been successfully received'
        return form
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB})
    assert result['status']=='applied',result
    assert len(posts)==2 and CV in posts[0] and CV in posts[1]
    assert result['report']['attachment_uploads']==[{'attachment':'resume','status':'accepted','attempts':1}]
    assert UPLOAD_HOST not in result['report']['navigation']['automatic_application_hosts']


@pytest.mark.parametrize('mode',['check_only','rejected'])
def test_check_only_and_rejected_upload_never_click_submit(mode):
    data=ticket();form=remote_upload_form(data)
    def employer(req):
        if req.url==TICKET:return {'body':json.dumps(data),'content_type':'application/json'}
        if req.url==STORAGE+'/':return {'body':'Denied','status':403}
        return form
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB},submit=mode!='check_only')
    assert result['status']=='needs_attention',result
    assert len(posts)==(0 if mode=='check_only' else 1)
    if mode=='rejected':assert 'Submit was not clicked' in result['message']
