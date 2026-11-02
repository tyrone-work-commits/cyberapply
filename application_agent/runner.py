"""Run the new application browser against owner-authorized Site claims."""
from __future__ import annotations

import argparse
import getpass
import json
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request

from .browser import execute_application, validate_public_url

def upload_recording(site,token,task,info,site_access_token=None):
    """Idempotent media-only upload. Never calls an employer or queues a job."""
    import hashlib
    from urllib.request import build_opener
    path=info['path'];size=path.stat().st_size
    with path.open('rb') as file:checksum=hashlib.file_digest(file,'sha256').hexdigest()
    query=urlencode({'requestId':task['requestId'],'claimId':task['claimId'],**({'part':info['part']} if 'part' in info else {})})
    status=call_site(site,token,'/api/application-agent/recording?'+query,site_access_token=site_access_token)
    if status.get('saved'):
        if status.get('sha256')!=checksum:raise ValueError('A different recording is already saved for this run.')
        return status
    headers={'Authorization':'Bearer '+token,'Content-Type':'video/mp4','Content-Length':str(size),
             'X-Recording-SHA256':checksum,'X-Recording-Duration':str(info['duration']),
             'X-Recording-Started-At':info['startedAt'],'X-Recording-Partial':'true' if info['partial'] else 'false',
             'X-Recording-Reason':info.get('reason',''),**({'OAI-Sites-Authorization':'Bearer '+site_access_token} if site_access_token else {})}
    with path.open('rb') as file:
        request=Request(site+'/api/application-agent/recording?'+query,data=file,headers=headers,method='POST')
        with build_opener(NoRedirect()).open(request,timeout=30) as response:return json.loads(response.read(10000))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("The Site endpoint redirected. Check the Site address; credentials were not forwarded.")


def parse_connection(raw, site):
    """Accept one-time Site-bound connection JSON without storing credentials."""
    if len(raw) > 10000:
        raise ValueError('The connection string is too large.')
    token, service_token = raw, None
    if raw.startswith('{'):
        try:
            connection=json.loads(raw)
            if not isinstance(connection,dict) or connection.get('site','').rstrip('/') != site.rstrip('/'):
                raise ValueError()
            token, service_token=connection.get('token'), connection.get('serviceToken')
            if service_token is not None and (not isinstance(service_token,str) or not service_token.strip()):
                raise ValueError()
        except (ValueError,TypeError,AttributeError):
            raise ValueError('This connection string is invalid or belongs to a different Site.') from None
    if not isinstance(token,str) or not re.fullmatch(r'ca2\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})',token):
        raise ValueError('Use a new application-agent connection from Settings. Old pairing tokens are not supported.')
    return token, service_token


def call_site(site, token, path, data=None, binary=False, site_access_token=None, timeout=40):
    from urllib.request import build_opener
    req = Request(site + path, data=json.dumps(data).encode() if data is not None else None,
                  headers={"Authorization":"Bearer " + token, "Content-Type":"application/json", "Accept":"application/octet-stream" if binary else "application/json",
                           **({'OAI-Sites-Authorization':'Bearer '+site_access_token} if site_access_token else {})},
                  method="POST" if data is not None else "GET")
    with build_opener(NoRedirect()).open(req, timeout=timeout) as response:
        limit = 15_000_001 if binary else 2_000_000
        raw = response.read(limit)
        if len(raw) >= limit:
            raise ValueError("The Site response exceeded the permitted size.")
        return raw if binary else json.loads(raw)


def deliver_questions(site,token,task,report,site_access_token=None):
    """Save the full question catalog before an oversized diagnostic is abbreviated.

    Only metadata calls are retried. This never retries an employer or result POST.
    """
    answers={str(row.get('question','')).strip().casefold():row for row in report.get('answers',[]) if isinstance(row,dict)}
    rows=[]
    for question in report.get('questions',[]):
        if not isinstance(question,dict):continue
        label=str(question.get('question','')).strip();kind=str(question.get('field_type','text'))
        if not label or len(label)>4000 or kind in {'file','password','hidden'} or re.search(r'password|captcha|verification code|security code|unlabelled field',label,re.I):continue
        row={'question':label,'field_type':kind[:50],'options':[str(v)[:200] for v in question.get('options',[])[:15]]}
        answer=answers.get(label.casefold(),{})
        if answer.get('source') in {'cv','cv_and_job','edit_profile'} and isinstance(answer.get('value'),str):
            row.update(value=answer['value'][:2000],source=answer['source'],evidence=str(answer.get('evidence',''))[:600])
        rows.append(row)
    batches=[];batch=[]
    for row in rows:
        if batch and (len(batch)>=100 or len(json.dumps(batch+[row]))>40000):batches.append(batch);batch=[]
        batch.append(row)
    if batch:batches.append(batch)
    saved=omitted=failed=0
    for batch in batches:
        for attempt in range(2):
            try:
                result=call_site(site,token,'/api/application-agent/questions',{'requestId':task['requestId'],'claimId':task['claimId'],'questions':batch},site_access_token=site_access_token)
                saved+=result.get('saved',0);omitted+=result.get('omitted',0);break
            except Exception:
                if attempt:failed+=len(batch)
    return {'saved':saved,'omitted':omitted,'deliveryFailed':failed}


def run_once(site, token, submit=False, allowed_hosts=(), browser_channel='chrome', site_access_token=None, on_state=None):
    from .recording_delivery import RecordingDelivery,flush_pending
    try:flush_pending(site,token,site_access_token)
    except Exception:pass
    task = call_site(site, token, "/api/application-agent/claim", {"profileAnswersVersion":4}, site_access_token=site_access_token)["task"]
    if not task:
        return False
    if on_state:on_state('working')
    query = urlencode({"requestId":task["requestId"], "claimId":task["claimId"]})
    watch=None;delivery=None
    try:
        cv_bytes = call_site(site, token, "/api/application-agent/cv?" + query, binary=True, site_access_token=site_access_token)
        from .live_watch import LiveWatch
        try:
            delivery=RecordingDelivery(site,token,task,site_access_token)
            watch=LiveWatch(lambda body:call_site(site,token,'/api/application-agent/watch',body,site_access_token=site_access_token,timeout=4),task['requestId'],task['claimId'],record=True,on_part=delivery.part)
            delivery.observe(watch.recording)
        except Exception:watch=None
        def authorize():
            return call_site(site,token,"/api/application-agent/authorize",{"requestId":task["requestId"],"claimId":task["claimId"]}, site_access_token=site_access_token).get("authorized") is True
        import sys
        sessions=None
        if sys.platform=='win32':
            from .login_sessions import LoginSessions
            sessions=LoginSessions(site,token.split('.')[1])
        result = execute_application(task, cv_bytes, submit=submit, allowed_hosts=allowed_hosts, before_submit=authorize,
                                     browser_channel=None if browser_channel=='chromium' else browser_channel,
                                     session_store=sessions,interactive_login=submit,live_watch=watch)
    except Exception:
        result = {"status":"failed", "message":"The selected CV could not be read. No employer submission was attempted."}
    finally:
        if watch:
            try:watch.close()
            except Exception:pass
    # This result POST is never automatically retried: retain the claim if delivery is uncertain.
    if len(json.dumps(result.get('report',{}))) > 55000:
        report=result['report']
        memory=deliver_questions(site,token,task,report,site_access_token)
        result['report']={"experience":report.get('experience',{}),"unresolved":report.get('unresolved',[])[:30],
                          "cover_letter":str(report.get('cover_letter',''))[:12000],"answers":report.get('answers',[])[:10],
                          "recovery":report.get('recovery',{}),
                          "research":{"note":"Report abbreviated to fit the saved record; no additional answers were invented."}}
        if len(json.dumps(result['report'])) > 55000:
            result['report']={"note":"Detailed report exceeded the saved record limit.","experience":report.get('experience',{}),"recovery":report.get('recovery',{})}
    if 'memory' in locals():result['report']['questionDelivery']=memory
    info=watch.recording_info if watch else None
    result.setdefault('report',{})['recording']={'capture':'ready' if info else 'unavailable',**({'durationSeconds':round(watch.recording.frames/8,3) if getattr(watch,'recording',None) else info['duration'],'parts':watch.recording.parts if getattr(watch,'recording',None) else 1,'partial':watch.recording.partial if getattr(watch,'recording',None) else info['partial']} if info else {})}
    try:
        call_site(site, token, "/api/application-agent/result", {"requestId":task["requestId"],"claimId":task["claimId"],**result}, site_access_token=site_access_token)
    finally:
        if delivery:
            try:delivery.finish(getattr(watch,'recording',None))
            except Exception:pass
        if info and not delivery:
            for attempt in range(2):
                try:
                    upload_recording(site,token,task,info,site_access_token)
                    break
                except Exception:
                    if attempt:print('Application recording upload could not be confirmed. Application outcome is unchanged.')
        if watch:watch.cleanup_recording()
    print("Application agent:", result["status"], "—", result["message"])
    return True


def main():
    parser = argparse.ArgumentParser(description="CyberApply CV application agent. Run from the repository root.")
    parser.add_argument("--site", required=True, help="Your HTTPS CyberApply Site address")
    parser.add_argument("--once", action="store_true", help="Check for one request, then stop")
    parser.add_argument("--submit", action="store_true", help="Permit final submission of newly authorized Apply requests")
    parser.add_argument("--allow-host", action="append", default=[], help="Additional employer/ATS hostname approved for this run")
    parser.add_argument("--browser-channel", choices=['chrome','msedge','chromium'], default='chrome', help="Installed Chrome/Edge, or a separately installed Playwright Chromium")
    parser.add_argument("--private-site", action='store_true', help="Prompt for the separate Site service access token; sent only to this Site")
    args = parser.parse_args()
    site = args.site.rstrip('/')
    from urllib.parse import urlsplit
    if urlsplit(site).path not in ('','/') or urlsplit(site).query or urlsplit(site).fragment:
        parser.error("--site must be the Site origin, without a path, query or fragment")
    validate_public_url(site)
    connection = getpass.getpass("New application-agent connection string or token (input hidden): ").strip()
    try:
        token, site_access_token = parse_connection(connection,site)
    except ValueError as exc:
        parser.error(str(exc))
    if args.private_site and not site_access_token:
        site_access_token = getpass.getpass('Site service access token (input hidden): ').strip()
    if args.private_site and not site_access_token:
        parser.error('The private Site requires its service access token')
    print("Submission enabled." if args.submit else "Dry run: forms may be filled, but final submission is disabled.")
    try:
        while True:
            run_once(site, token, args.submit, args.allow_host, args.browser_channel, site_access_token)
            if args.once:
                break
            time.sleep(5)
    except KeyboardInterrupt:
        print("Agent stopped.")
    except HTTPError as exc:
        print(f"The Site rejected the request (HTTP {exc.code}). Reconnect in Settings; no automatic retry was made.")
        raise SystemExit(1) from None
    except Exception:
        print("The agent stopped. Check Applications before restarting; no automatic retry was made.")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
