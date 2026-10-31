"""Bounded CV application browser. Employer pages are data, never instructions.

Only an explicit ``submit=True`` permits the final submission. Unknown required
questions and uncertain outcomes are returned to the user rather than guessed.
"""
from __future__ import annotations

import hashlib
import json
import ipaddress
import re
import socket
from urllib.parse import urlsplit, parse_qsl
from .combobox import DropdownAttention, select_combobox, selected_display, has_unreviewed_selection
from .recovery import FormRecovery, RecoveryStopped, TransientFormError
from .uploads import GreenhouseUploads, UploadRejected, UPLOAD_HOST

# Exact provider domains only: never trust lookalike suffixes or private DNS.
# These aliases are part of one supported application service, so the user
# does not have to approve a normal legacy-to-current board transition.
APPLICATION_HOST_GROUPS = (
    frozenset({'boards.greenhouse.io','job-boards.greenhouse.io','boards-api.greenhouse.io'}),
    frozenset({'boards.eu.greenhouse.io','job-boards.eu.greenhouse.io','boards-api.eu.greenhouse.io'}),
    frozenset({'jobs.lever.co','api.lever.co'}),
    frozenset({'jobs.eu.lever.co','api.eu.lever.co'}),
)


def automatic_application_hosts(job):
    origins={(urlsplit(str(job.get(key) or '')).hostname or '').lower().rstrip('.') for key in ('url','applyUrl')}
    return set().union(*(group for group in APPLICATION_HOST_GROUPS if origins.intersection(group)))


def static_asset_hosts(job):
    origins={(urlsplit(str(job.get(key) or '')).hostname or '').lower().rstrip('.') for key in ('url','applyUrl')}
    return {'job-boards.cdn.greenhouse.io'} if origins.intersection(set().union(*APPLICATION_HOST_GROUPS[:2])) else set()


def allowed_static_asset(url,method,resource_type,asset_hosts):
    try:
        parsed=urlsplit(url)
        port=parsed.port
    except ValueError:return False
    extension={'script':'js','stylesheet':'css'}.get(resource_type)
    static_path=(extension and re.fullmatch(r'/assets/[A-Za-z0-9_.-]{1,200}\.'+extension,parsed.path)) or (
        resource_type in {'fetch','xhr'} and re.fullmatch(r'/locales/en/(?:job_post|common)\.[A-Za-z0-9_-]{20,80}\.json',parsed.path))
    return bool(static_path and method=='GET' and parsed.scheme=='https' and parsed.hostname in asset_hosts
                and not parsed.username and not parsed.password and port in (None,443)
                and not parsed.query and not parsed.fragment)


def optional_tracking_request(url,method,resource_type,application_host):
    """This observed Greenhouse analytics call is always aborted, never allowed.

    Do not treat an optional denied tracker as an application destination.
    Navigations, lookalikes and any other path keep the normal hard stop.
    """
    try:
        parsed=urlsplit(url)
        return (application_host in APPLICATION_HOST_GROUPS[0]
                and parsed.scheme=='https' and parsed.hostname=='c.spl.greenhouse.io'
                and parsed.port in (None,443) and not parsed.username and not parsed.password
                and parsed.path=='/com.snowplowanalytics.snowplow/tp2'
                and not parsed.query and not parsed.fragment
                and method=='POST' and resource_type in {'fetch','xhr'})
    except ValueError:return False


CITY_LOOKUP_HOST='api-geocode-earth-proxy.greenhouse.io'


def allowed_city_lookup(url,method,resource_type,application_host,profile):
    """Read only the observed locality search, for the owner's exact saved city."""
    try:
        parsed=urlsplit(url)
        pairs=parse_qsl(parsed.query,keep_blank_values=True,strict_parsing=True)
        params=dict(pairs)
        city=profile.get('city','')
        return bool(application_host in APPLICATION_HOST_GROUPS[0] and method=='GET' and resource_type in {'fetch','xhr'}
            and parsed.scheme=='https' and parsed.hostname==CITY_LOOKUP_HOST and parsed.port in (None,443)
            and not parsed.username and not parsed.password and not parsed.fragment and parsed.path=='/v1/autocomplete'
            and len(pairs)==len(params)==4 and set(params)=={'api_key','layers','lang','text'}
            and re.fullmatch(r'[A-Za-z0-9_-]{8,128}',params['api_key']) and params['layers']=='locality'
            and re.fullmatch(r'[a-z]{2}(?:-[A-Z]{2})?',params['lang'])
            and isinstance(city,str) and 1<len(city.strip())<=120 and not re.search(r'[\r\n\x00-\x1f]',city)
            and params['text'].strip().casefold()==city.strip().casefold())
    except (ValueError,TypeError):return False


class ApplicationAttention(Exception):
    pass


def validate_public_url(url, allowed_hosts=None, resolver=socket.getaddrinfo):
    """Reject credentials, local networks and unapproved destination hosts."""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError()
        if allowed_hosts is not None and host not in allowed_hosts:
            raise ApplicationAttention(f"This employer form uses an unsupported destination: {host}.")
        addresses = resolver(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ValueError()
        return host
    except ApplicationAttention:
        raise
    except (ValueError, OSError, TypeError):
        raise ApplicationAttention("A public HTTPS employer address is required.") from None


INSPECT = """() => {
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && !e.closest('[aria-hidden="true"],[inert]');
  const labelText = label => {const copy=label.cloneNode(true);copy.querySelectorAll('input,textarea,select,[role=combobox],[role=radio],[role=checkbox],script,style').forEach(e=>e.remove());return (copy.textContent||'').replace(/\\s+/g,' ').trim();};
  return [...document.querySelectorAll('input,textarea,select,[role=combobox],[role=radio],[role=checkbox]')]
    .filter(visible).filter(e => !['hidden','submit','button','reset'].includes(e.type)||(e.type==='button'&&e.getAttribute('role')==='combobox'))
    .filter(e => !e.parentElement?.closest('[role=combobox]'))
    .slice(0,101).map((e,i) => {
      const id='cyberapply-'+i; e.setAttribute('data-cyberapply-field',id);
      const labels=[...(e.labels||[])].map(labelText).join(' ');
      const labelled=(e.getAttribute('aria-labelledby')||'').split(/\\s+/).map(x=>document.getElementById(x)?.innerText||'').join(' ');
      let optionLabel=(labels||e.getAttribute('aria-label')||labelled||e.placeholder||e.name||e.id||'Unlabelled field').trim().slice(0,1000);
      if(e.type==='file'&&/^attach(?: file)?$/i.test(optionLabel)&&/^(?:resume|cv|cover[_-]?letter)$/i.test(e.name||e.id||'')) optionLabel=e.name||e.id;
      const type=e.tagName==='SELECT'?'select':e.tagName==='TEXTAREA'?'textarea':e.getAttribute('role')||e.type||'text';
      const phoneGroup=e.closest('fieldset.phone-input');
      const phoneCountry=type==='combobox'&&e.id==='country'&&phoneGroup&&phoneGroup.querySelectorAll('input[type=tel]').length===1&&/^phone\\s*\\*?$/i.test((phoneGroup.querySelector('legend')?.textContent||'').trim());
      const groupParent=e.closest('fieldset,[role=radiogroup]');
      const groupQuestion=(groupParent?.querySelector(':scope > legend')?.innerText||groupParent?.getAttribute('aria-label')||
        (groupParent?.getAttribute('aria-labelledby')||'').split(/\\s+/).map(x=>document.getElementById(x)?.innerText||'').join(' ')).trim();
      const peers=type==='radio'&&e.name?[...document.querySelectorAll('input[type=radio]')].filter(x=>visible(x)&&x.name===e.name&&x.form===e.form):[];
      const label=type==='radio'&&groupQuestion?groupQuestion:optionLabel;
      return {id,label,type,phoneCountry:!!phoneCountry,optionLabel,optionValue:e.value||'',group:type==='radio'?((e.name||e.id)+'@'+[...document.forms].indexOf(e.form)):'',groupQuestion,
        nativeControl:['INPUT','SELECT','TEXTAREA'].includes(e.tagName),numeric:e.type==='number'||['numeric','decimal'].includes(e.inputMode),
        required:e.required||e.getAttribute('aria-required')==='true',
        options:e.options?[...e.options].map(o=>o.text):peers.map(x=>[...(x.labels||[])].map(labelText).join(' ').trim()),
        value:e.value||'',checked:e.checked||e.getAttribute('aria-checked')==='true'};
    });
}"""

SUCCESS = re.compile(r"(?:your application (?:has been |was )?(?:successfully )?(?:submitted|received)|thank you for applying|application (?:successfully submitted|received successfully)|we(?:'|’)ve received your application)", re.I)

CONTROL_IDENTITY = """e => {
 const text=n=>{const c=n.cloneNode(true);c.querySelectorAll('input,textarea,select,[role=combobox],script,style').forEach(x=>x.remove());return (c.textContent||'').replace(/\\s+/g,' ').trim();};
 return JSON.stringify([e.tagName,e.type,e.id,e.name,e.getAttribute('role'),e.getAttribute('aria-label'),
 [...(e.labels||[])].map(text),(e.getAttribute('aria-labelledby')||'').split(/\\s+/).map(id=>document.getElementById(id)?.textContent||'')]);
}"""


def _result(status, message, report=None, **kwargs):
    return {"status": status, "message": message, **({"report": report} if report else {}), **kwargs}


def restrict_transports(context):
    context.route_web_socket('**/*',lambda websocket:websocket.close())
    context.add_init_script("""(() => {
      for (const name of ['WebSocket','WebTransport','RTCPeerConnection','webkitRTCPeerConnection']) {
        Object.defineProperty(globalThis,name,{value:class {
          constructor(){throw new Error('This network transport is unavailable in the application agent.');}
        },writable:false,configurable:false});
      }
    })();""")


def execute_application(payload, cv_bytes, *, submit=False, allowed_hosts=(), playwright_factory=None,
                        research_fn=None, planner=None, resolver=socket.getaddrinfo, timeout=15000, before_submit=None,
                        browser_channel=None, session_store=None, interactive_login=False, login_handler=None):
    """Inspect/fill a single claim. No application is retried after final click."""
    if planner is None:
        from .reasoning import build_plan
        planner = build_plan
    if research_fn is None:
        from .research import fetch_research
        research_fn = fetch_research
    report = {"answers": [], "unresolved": [], "research": {}, "experience": {}, "cover_letter": ""}
    submitted = False
    browser = None
    context = None
    session_active = False
    def finish(*args,**kwargs):
        if session_active and context and session_store:
            try:session_store.save(job,hosts,context.storage_state(),refresh=True)
            except Exception:pass
        result=_result(*args,**kwargs)
        repaired=sum(event.get('outcome')=='recovered' for event in report.get('recovery',{}).get('events',[]))
        if repaired:result['message']+=f' Automatically recovered from {repaired} temporary form problem(s).'
        return result
    try:
        cv = payload.get("cv") or {}
        if not cv_bytes or len(cv_bytes) > 15_000_000 or hashlib.sha256(cv_bytes).hexdigest() != cv.get("sha256"):
            raise ApplicationAttention("The selected CV bytes do not match this Apply request. Choose the CV again.")
        job = payload.get("job") or {}
        url = job.get("applyUrl") or job.get("url") or ""
        original_host = validate_public_url(url, resolver=resolver)
        automatic=automatic_application_hosts(job)
        asset_candidates=static_asset_hosts(job)
        read_candidates={CITY_LOOKUP_HOST} if original_host in APPLICATION_HOST_GROUPS[0] and (payload.get('applicantProfile') or {}).get('city') else set()
        upload_candidates={UPLOAD_HOST} if original_host in APPLICATION_HOST_GROUPS[0] else set()
        requested_hosts = {original_host, *automatic, *asset_candidates, *read_candidates, *upload_candidates, *(str(x).lower().rstrip('.') for x in allowed_hosts)}
        hosts=set()
        assets=set()
        reads=set()
        upload_hosts=set()
        pins = []
        for host in [original_host,*sorted(requested_hosts-{original_host})]:
            try:
                validate_public_url("https://" + host, resolver=resolver)
                addresses = resolver(host,443,type=socket.SOCK_STREAM)
            except ApplicationAttention:
                if host in automatic|asset_candidates|read_candidates|upload_candidates and host!=original_host:
                    continue  # An unavailable optional alias must not stop the selected board.
                raise
            if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
                raise ApplicationAttention('The employer address changed to a non-public network.')
            (upload_hosts if host in upload_candidates else reads if host in read_candidates else assets if host in asset_candidates else hosts).add(host)
            address = next((row[4][0] for row in addresses if ':' not in row[4][0]), addresses[0][4][0])
            pins.append(f"MAP {host} {'[' + address + ']' if ':' in address else address}")
        report['navigation']={'automatic_application_hosts':sorted(hosts.intersection(automatic)),'static_asset_hosts':sorted(assets),'form_read_hosts':sorted(reads),'attachment_upload_hosts':sorted(upload_hosts)}
        uploads=GreenhouseUploads(bool(upload_hosts),report)
        report["research"] = research_fn(payload)
        if playwright_factory is None:
            from playwright.sync_api import sync_playwright
            playwright_factory = sync_playwright
        with playwright_factory() as runtime:
            launch_options=dict(headless=True, args=['--no-proxy-server','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules='+', '.join(pins)],**({'channel':browser_channel} if browser_channel else {}))
            browser = runtime.chromium.launch(**launch_options)
            saved_session=session_store.load(job,hosts) if session_store else None
            session_active=bool(saved_session)
            report['login_session']={'reused':session_active,'saved':False}
            context = browser.new_context(accept_downloads=False, service_workers="block",**({'storage_state':saved_session} if saved_session else {}))
            def observe_city_lookup(response):
                request=response.request
                if not allowed_city_lookup(request.url,request.method,request.resource_type,original_host,payload.get('applicantProfile') or {}):return
                try:
                    status='unavailable';count=None
                    if response.status==200:
                        raw=response.body()
                        data=json.loads(raw) if len(raw)<=200000 else {}
                        features=data.get('features') if isinstance(data,dict) else None
                        if isinstance(features,list):count=len(features);status='no_results' if not features else 'results_returned'
                    report['city_lookup']={'status':status,**({'result_count':count} if count is not None else {})}
                except Exception:pass
            context.on('response',observe_city_lookup)
            context.on('response',uploads.observe_ticket)
            context.on('response',uploads.observe_upload)
            # Job forms need HTTP, not arbitrary peer/socket transports that bypass
            # request routing. Apply this before any page or iframe script executes.
            restrict_transports(context)
            blocked = []

            def guard(route):
                nonlocal submitted
                req = route.request
                if optional_tracking_request(req.url,req.method,req.resource_type,original_host):
                    diagnostics=report.setdefault('suppressed_background_requests',[])
                    entry={'host':'c.spl.greenhouse.io','method':req.method,'resource_type':req.resource_type,'reason':'Optional analytics blocked; not an application destination.'}
                    if entry not in diagnostics and len(diagnostics)<20:diagnostics.append(entry)
                    route.abort()
                    return
                try:
                    if (urlsplit(req.url).hostname or '').lower() in upload_hosts:
                        validate_public_url(req.url,upload_hosts,resolver)
                        if not submit:
                            route.abort()
                            return
                        try:
                            if req.method=='OPTIONS':uploads.permit_preflight(req,before_submit or (lambda:False))
                            else:uploads.permit(req,before_submit or (lambda:False))
                        except UploadRejected as error:raise ApplicationAttention(str(error)) from None
                        route.continue_()
                        return
                    if (urlsplit(req.url).hostname or '').lower() in reads:
                        validate_public_url(req.url,reads,resolver)
                        if not allowed_city_lookup(req.url,req.method,req.resource_type,original_host,payload.get('applicantProfile') or {}):
                            raise ApplicationAttention('The city lookup cannot receive other application data.')
                        route.continue_()
                        return
                    if (urlsplit(req.url).hostname or '').lower() in assets:
                        validate_public_url(req.url,assets,resolver)
                        if not allowed_static_asset(req.url,req.method,req.resource_type,assets):
                            raise ApplicationAttention('The provider asset host cannot receive application data.')
                        route.continue_()
                        return
                    # Supported provider aliases are resolved and pinned before launch.
                    # Unrelated assets are blocked without making optional telemetry
                    # a reason to stop an otherwise readable application form.
                    validate_public_url(req.url, hosts, resolver)
                    if req.method not in ('GET','HEAD','OPTIONS'):
                        if not submit:
                            route.abort()  # Dry runs also block employer autosave POSTs.
                            return
                        if before_submit is None or before_submit() is not True:
                            blocked.append(req.url.split('?')[0])
                            route.abort()
                            return
                        submitted = True  # Some forms autosave as fields change.
                    route.continue_()
                except ApplicationAttention:
                    if req.method not in ('GET','HEAD','OPTIONS') or req.resource_type in ('document','xhr','fetch'):
                        # An aborted optional read must not hide an otherwise
                        # usable form. Missing essential data will still fail
                        # field inspection/selection. Navigation, writes and
                        # misuse of the static CDN remain hard blockers.
                        if (submit and req.method not in ('GET','HEAD','OPTIONS')) or req.resource_type=='document' or (urlsplit(req.url).hostname or '').lower() in assets:
                            blocked.append(req.url.split('?')[0])
                        # Explain the boundary without retaining URL paths, query
                        # strings, request bodies or applicant data in diagnostics.
                        diagnostic={'host':(urlsplit(req.url).hostname or ''),'method':req.method,'resource_type':req.resource_type}
                        destinations=report.setdefault('blocked_destinations',[])
                        if diagnostic not in destinations and len(destinations)<20:destinations.append(diagnostic)
                    route.abort()

            context.route("**/*", guard)
            page = context.new_page()
            page.set_default_timeout(timeout)
            recovery=FormRecovery(report,
                can_retry=lambda:not submitted and not blocked and (not submit or before_submit is not None and before_submit() is True),
                wait=page.wait_for_timeout)
            def open_initial_page():
                response=page.goto(url, wait_until="domcontentloaded", timeout=timeout * 2)
                if response and response.status in {502,503,504}:
                    raise TransientFormError('The employer page is temporarily unavailable.')
            recovery.run('open_employer_page',open_initial_page)
            page.wait_for_timeout(700)
            seen_steps = set()
            login_attempted=False
            for _step in range(6):
                validate_public_url(page.url, hosts, resolver)
                if blocked:
                    raise ApplicationAttention("This employer form uses an unsupported application destination. Open its original page to continue manually.")
                frames = []
                for frame in page.frames:
                    if frame.url in ("about:blank", ""):
                        continue
                    validate_public_url(frame.url, hosts, resolver)
                    frames.append(frame)
                fields, controls = [], {}
                login_frame=next((frame for frame in frames if frame.locator('input[type="password"]:visible').count()),None)
                if login_frame:
                    if submitted:
                        raise ApplicationAttention('Sign-in was requested after possible partial delivery. Check the employer outcome before retrying.')
                    if not interactive_login or not session_store or login_attempted:
                        raise ApplicationAttention('The employer requires sign-in. Its saved session is unavailable or expired; sign in privately before continuing.')
                    login_attempted=True
                    if before_submit is None or before_submit() is not True:
                        raise ApplicationAttention('This request no longer has authorization for employer sign-in.')
                    if login_handler is None:
                        from .login_handoff import sign_in
                        login_handler=sign_in
                    signed_in=login_handler(runtime,launch_options,context.storage_state(),login_frame.url,hosts,before_submit)
                    if not signed_in:
                        raise ApplicationAttention('Sign-in was cancelled or timed out. No application was submitted.')
                    if before_submit() is not True:
                        raise ApplicationAttention('This request no longer has authorization after sign-in.')
                    # Resume the selected vacancy using the private sign-in state.
                    # Never return to the start after a possibly delivered POST.
                    from .login_sessions import scoped_state
                    restored=scoped_state(signed_in['state'],hosts)
                    session_store.save(job,hosts,restored)
                    session_active=True
                    report['login_session']['saved']=True
                    context.close()
                    context=browser.new_context(accept_downloads=False,service_workers='block',storage_state=restored)
                    context.on('response',observe_city_lookup)
                    context.on('response',uploads.observe_ticket)
                    context.on('response',uploads.observe_upload)
                    restrict_transports(context)
                    context.route('**/*',guard)
                    blocked.clear()
                    page=context.new_page()
                    page.set_default_timeout(timeout)
                    page.goto(url,wait_until='domcontentloaded',timeout=timeout*2)
                    page.wait_for_timeout(500)
                    continue
                for frame in frames:
                    if frame.locator('[data-sitekey]:visible, iframe[src*="recaptcha"]:visible, iframe[src*="hcaptcha"]:visible, iframe[src*="challenges.cloudflare.com"]:visible').count():
                        raise ApplicationAttention("The employer requires a verification challenge. Please complete it yourself.")
                def read_forms():
                    # An embedded application can appear after the shell page.
                    # Rediscover frames only before any controls are filled.
                    frames[:]=[frame for frame in page.frames if frame.url not in ('about:blank','')]
                    for frame in frames:
                        validate_public_url(frame.url,hosts,resolver)
                        if frame.locator('[data-sitekey]:visible, iframe[src*="recaptcha"]:visible, iframe[src*="hcaptcha"]:visible, iframe[src*="challenges.cloudflare.com"]:visible').count():
                            raise ApplicationAttention('The employer requires a verification challenge. Please complete it yourself.')
                    found=[(idx,frame,frame.evaluate(INSPECT)) for idx,frame in enumerate(frames)]
                    if not any(items for _,_,items in found) and not page.get_by_role('link',name=re.compile(r'^apply(?: now| for (?:this )?(?:job|role|position))?$',re.I)).count():
                        page.wait_for_timeout(300)
                        raise TransientFormError('The employer form is still loading.')
                    return found
                for fidx,frame,items in recovery.run('read_form',read_forms):
                    for field in items:
                        local_id = field["id"]
                        field["id"] = f"{fidx}:{local_id}"
                        if field.get('group'):
                            field['group']=f'{fidx}:{field["group"]}'
                        controls[field["id"]] = frame.locator(f'[data-cyberapply-field="{local_id}"]')
                        fields.append(field)
                if not fields or len(fields) > 100:
                    if not fields:
                        links = page.get_by_role('link', name=re.compile(r'^apply(?: now| for (?:this )?(?:job|role|position))?$', re.I))
                        if links.count() == 1:
                            href = links.get_attribute('href')
                            from urllib.parse import urljoin
                            target = urljoin(page.url, href or '')
                            validate_public_url(target, hosts, resolver)
                            page.goto(target, wait_until='domcontentloaded')
                            page.wait_for_timeout(500)
                            continue
                    raise ApplicationAttention("No supported application form was found, or it has too many fields to inspect reliably.")
                signature = tuple((f["id"], f["label"], f["type"], f['required']) for f in fields)
                if signature in seen_steps:
                    raise ApplicationAttention("The employer form did not advance. Review its validation messages.")
                seen_steps.add(signature)
                plan = planner(payload, fields, report["research"])
                report["experience"] = plan.get("experience", {})
                report["cover_letter"] = plan.get("cover_letter", "")
                unresolved = list(plan.get("unresolved") or [])
                answers = {a["field_id"]: a for a in plan.get("answers", [])}
                handled_confirmed = set()
                expected_values = {}
                def exact_confirmed(field, answer):
                    normalize=lambda s:re.sub(r'\s+',' ',str(s)).strip().casefold()
                    same_question=[f for f in fields if f['type']==field['type'] and normalize(f['label'])==normalize(field['label'])]
                    if field['type'] in {'checkbox','combobox'} and len(same_question)!=1:
                        return False
                    if field['type']=='radio' and len({f.get('group') for f in same_question})!=1:
                        return False
                    return answer and answer.get('source')=='user_confirmed' and any(
                        normalize(item.get('question',''))==normalize(field['label']) and (
                            str(item.get('value',''))==str(answer['value']) or
                            field['type']=='checkbox' and answer['value']=='true' and normalize(item.get('value','')) in {'true','yes','i agree'}
                        ) for item in payload.get('confirmedAnswers',[]) if isinstance(item,dict))
                def approved_choice(field,answer):
                    if exact_confirmed(field,answer):return True
                    if not answer:return False
                    from .profile_answers import profile_field,saved_profile_answer
                    from .answer_drafts import experience_answer
                    key=profile_field(field['label'])
                    if answer.get('source')=='edit_profile' and key and (key.endswith(('VisaRequired','RightToWork')) or key=='residenceQuestion'):
                        expected,_,_=saved_profile_answer(payload,field['label'],field)
                    elif answer.get('source')=='cv' and not re.search(r'consent|agree|privacy|terms',field['label'],re.I):
                        known=experience_answer(field['label'],str(cv.get('text','')),field['type'])
                        expected=known[0] if known and not known[2] else None
                    else:return False
                    if field['type']=='checkbox' and expected in {'Yes','No'}:expected='true' if expected=='Yes' else 'false'
                    return expected is not None and expected==answer.get('value')
                for field in fields:
                    control = controls[field["id"]]
                    kind, label = field["type"], field["label"].lower()
                    answer = answers.get(field["id"])
                    identity=control.evaluate(CONTROL_IDENTITY)
                    def same_question(operation):
                        if control.evaluate(CONTROL_IDENTITY)!=identity:
                            raise ApplicationAttention('The employer changed this question during preparation. The old answer was not replayed; inspect the changed form before continuing.')
                        return operation()
                    if kind == "file":
                        if re.search(r"cover.?letter", label):
                            if not answer or answer.get('source')!='user_confirmed':
                                if not any(item.get('field_id')==field['id'] for item in unresolved):unresolved.append({'field_id':field['id'],'question':field['label'],'source':'generated','suggested_value':report['cover_letter'],'reason':'Approve the generated cover letter before upload.'})
                                continue
                            report['cover_letter']=str(answer['value'])
                            report['answers'].append({**answer,'question':field['label']})
                            if not report["cover_letter"]:
                                unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"No grounded cover letter was prepared."})
                            else:
                                uploads.arm('cover_letter','cover-letter.txt','text/plain',report['cover_letter'].encode())
                                control.set_input_files({"name":"cover-letter.txt","mimeType":"text/plain","buffer":report["cover_letter"].encode()})
                                expected_values[field['id']]=('file',{'name':'cover-letter.txt','size':len(report['cover_letter'].encode())})
                        elif re.search(r"resume|résumé|\bcv\b", label):
                            name = str(cv.get("name") or "CV.pdf").replace('\\','/').split('/')[-1]
                            uploads.arm('resume',name,cv.get('type') or 'application/octet-stream',cv_bytes)
                            control.set_input_files({"name":name,"mimeType":cv.get("type") or "application/octet-stream","buffer":cv_bytes})
                            expected_values[field['id']]=('file',{'name':name,'size':len(cv_bytes)})
                        elif field["required"]:
                            unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"This required attachment is not the selected CV."})
                        continue
                    answer = answers.get(field["id"])
                    if kind == 'checkbox':
                        if approved_choice(field,answer) and answer['value'] in {'true','false'} and field.get('nativeControl'):
                            control.set_checked(answer['value']=='true')
                            expected_values[field['id']]=('checked',answer['value']=='true')
                            handled_confirmed.add(field['id'])
                            report['answers'].append({**answer, 'question':field['label']})
                        elif field['required']:
                            unresolved.append({'field_id':field['id'],'question':field['label'],'reason':'This required checkbox needs explicit confirmation for this exact question.'})
                        elif field.get('checked'):
                            if not field.get('nativeControl'):
                                raise ApplicationAttention('The employer preselected an optional custom choice. Review it before applying.')
                            control.set_checked(False)  # Employer default opt-in is not user consent.
                        if field.get('nativeControl') and not field['required'] and field['id'] not in expected_values:
                            expected_values[field['id']]=('checked',False)
                        continue
                    if kind == 'radio':
                        if approved_choice(field,answer) and field.get('nativeControl') and field.get('groupQuestion') and field['options'].count(str(answer['value']))==1:
                            if str(answer['value'])==field.get('optionLabel'):
                                control.check()
                                expected_values[field['id']]=('checked',True)
                                report['answers'].append({**answer, 'question':field['label']})
                            handled_confirmed.add(field['id'])
                        elif field['required']:
                            if not any(item.get('field_id')==field['id'] for item in unresolved):
                                unresolved.append({'field_id':field['id'],'question':field['label'],'reason':'This required radio question needs an explicit matching choice.'})
                        elif field.get('checked'):
                            if not field.get('nativeControl'):
                                raise ApplicationAttention('The employer preselected an optional personal choice. Review it before applying.')
                            control.evaluate("e=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}")
                        if not approved_choice(field,answer) and not field['required'] and field.get('nativeControl'):
                            expected_values[field['id']]=('checked',False)
                        continue
                    if kind == "combobox":
                        from .profile_answers import profile_field, saved_profile_answer
                        from .answer_drafts import experience_answer
                        normalize=lambda s:re.sub(r'\s+',' ',str(s)).strip().casefold()
                        unique=sum(f['type']=='combobox' and normalize(f['label'])==normalize(field['label']) for f in fields)==1
                        permitted=bool(unique and exact_confirmed(field,answer))
                        if unique and answer and answer.get('source')=='edit_profile' and profile_field(field['label']):
                            expected,_,_=saved_profile_answer(payload,field['label'],field)
                            permitted=expected is not None and expected==answer.get('value')
                        elif unique and answer and answer.get('source')=='cv':
                            known=experience_answer(field['label'],str(cv.get('text','')),'select')
                            permitted=bool(known and not known[2] and known[0]==answer.get('value'))
                        try:
                            if answer and permitted:
                                dropdown_issue=['']
                                def choose_dropdown():
                                    try:return select_combobox(frames[int(field['id'].split(':',1)[0])],control,field,str(answer['value']),payload.get('applicantProfile') or {},timeout)
                                    except DropdownAttention as error:
                                        dropdown_issue[0]=str(error)
                                        if error.transient:raise TransientFormError(str(error)) from None
                                        raise
                                selected=recovery.run('select_labelled_dropdown',lambda:same_question(choose_dropdown),field['id'])
                                expected_values[field['id']]=('combobox',selected)
                                handled_confirmed.add(field['id'])
                                report['answers'].append({**answer,'question':field['label'],'selected_option':selected})
                            elif field['required'] or has_unreviewed_selection(control):
                                if not any(item.get('field_id')==field['id'] for item in unresolved):
                                    unresolved.append({'field_id':field['id'],'question':field['label'],'reason':'This dropdown needs a unique, fact-backed or explicitly confirmed answer. No option was assumed.'})
                        except RecoveryStopped as error:
                            report['unresolved']=[{'field_id':field['id'],'question':field['label'],'reason':dropdown_issue[0]+' '+str(error),'source':'agent_recovery'}]
                            if profile_field(field['label'])=='city' and report.get('city_lookup',{}).get('status')=='no_results':
                                message="The employer's city search found no match for the saved City. Enter your full city name in Edit Profile, then continue. No location was guessed."
                                report['unresolved'][0].update(reason=message,source='edit_profile')
                                raise ApplicationAttention(message) from None
                            raise
                        except DropdownAttention as error:
                            unresolved.append({'field_id':field['id'],'question':field['label'],'reason':str(error),'source':'agent_recovery'})
                        continue
                    if answer:
                        value = str(answer["value"])
                        if kind == "select":
                            if value not in field["options"]:
                                raise ApplicationAttention("A suggested answer does not match the employer's available choices.")
                            recovery.run('select_native_option',lambda:same_question(lambda:control.select_option(label=value,timeout=min(timeout,3000))),field['id'])
                            expected_values[field['id']]=('select',value)
                        elif kind in ("text", "email", "tel", "url", "number", "textarea", "search", "date"):
                            def fill_saved():
                                control.fill(value,timeout=min(timeout,3000))
                                from .profile_answers import profile_field
                                from .phone import matches_phone
                                if not (matches_phone(control,value) if profile_field(field['label'])=='phone' else control.input_value()==value):raise TransientFormError('The field did not retain the saved answer.')
                            recovery.run('fill_saved_answer',lambda:same_question(fill_saved),field['id'])
                            from .profile_answers import profile_field
                            expected_values[field['id']]=('phone' if profile_field(field['label'])=='phone' else 'value',value)
                        else:
                            unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"This control is not supported."})
                        report["answers"].append({**answer, "question":field["label"]})
                    elif field["required"] and not any(item.get('field_id')==field['id'] for item in unresolved):
                        unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"The CV or saved Edit Profile does not establish an answer."})
                # De-duplicate and ignore planner file omissions once the exact CV was uploaded.
                if submit:
                    try:uploads.settle(page,timeout)
                    except UploadRejected as error:raise ApplicationAttention(str(error)) from None
                if blocked:
                    raise ApplicationAttention('An employer request was blocked during preparation. Submit was not clicked; review the destination details in the report.')
                def verify_expected():
                    for field_id,(kind,expected) in expected_values.items():
                        control=controls[field_id]
                        from .phone import matches_phone
                        actual=(matches_phone(control,expected) if kind=='phone' else selected_display(control,expected,frames[int(field_id.split(':',1)[0])]) if kind=='combobox' else control.is_checked() if kind=='checked' else
                            control.evaluate("e=>e.files?.[0]?{name:e.files[0].name,size:e.files[0].size}:null") if kind=='file' else
                            control.evaluate("e=>e.selectedOptions[0]?.text||''") if kind=='select' else control.input_value())
                        if (kind in {'combobox','phone'} and actual is not True) or (kind not in {'combobox','phone'} and actual!=expected):
                            raise ApplicationAttention('An answer or attachment changed after preparation. Review the form before applying.')
                report["unresolved"] = list({x["field_id"]:x for x in unresolved if x['field_id'] not in handled_confirmed and not any(f["id"]==x["field_id"] and f["type"]=="file" and re.search(r"resume|résumé|\bcv\b|cover.?letter", f["label"],re.I) for f in fields)}.values())
                if report["unresolved"]:
                    technical=any(item.get('source')=='agent_recovery' for item in report['unresolved'])
                    return finish("uncertain" if submitted else "needs_attention", "The employer may have saved a partial application before requesting more answers. Check its status before retrying; review the agent report." if submitted else "Automatic form repairs could not confirm an employer control. Saved details are preserved; review the technical reason in the report." if technical else "The form needs answers or choices missing from the CV or saved Edit Profile. Review the saved agent report.", report)
                page.wait_for_timeout(300)
                refreshed = [(fidx, f) for fidx, frame in enumerate(frames) for f in frame.evaluate(INSPECT)]
                refreshed_signature = tuple((f'{idx}:{f["id"]}', f['label'], f['type'], f['required']) for idx, f in refreshed)
                if refreshed_signature != signature:
                    continue  # A selection revealed new questions; inspect them before any click.
                verify_expected()
                for frame in frames:
                    if frame.locator('input:invalid:visible, textarea:invalid:visible, select:invalid:visible').count():
                        raise ApplicationAttention("The employer rejected a field value or revealed another required answer. Review the form.")
                buttons, associated_buttons = [], []
                for fidx, frame in enumerate(frames):
                    prepared=[key.split(':',1)[1] for key in expected_values if key.startswith(f'{fidx}:')]
                    candidates = frame.locator('button:visible, input[type="submit"]:visible, input[type="button"]:visible')
                    for i in range(candidates.count()):
                        item = candidates.nth(i)
                        if item.is_enabled():
                            text = (item.inner_text() if item.evaluate("e=>e.tagName") != "INPUT" else item.get_attribute('value') or '').strip()
                            action=None
                            if re.fullmatch(r"(?:submit(?: application)?|send application|apply(?: now)?|complete application)",text,re.I):
                                action='submit'
                            elif re.fullmatch(r"(?:next|continue|next step|review application)",text,re.I):
                                action='next'
                            if action:
                                buttons.append((action,item))
                                # The page's introductory Apply button may just
                                # scroll to the form. Prefer actions belonging
                                # to a form that actually owns prepared inputs.
                                associated=item.evaluate("""(e,ids)=>{
                                  const owner=x=>x.form||x.closest('form,[role="form"]');
                                  const form=owner(e);if(!form)return false;
                                  return [...document.querySelectorAll('[data-cyberapply-field]')].some(
                                    x=>ids.includes(x.getAttribute('data-cyberapply-field'))&&owner(x)===form);
                                }""",prepared)
                                if associated:associated_buttons.append((action,item))
                if associated_buttons:buttons=associated_buttons
                report['submission_control']={'association':'prepared_application_form' if associated_buttons else 'unscoped_unique','candidate_count':len(buttons)}
                if len(buttons) != 1:
                    raise ApplicationAttention("The next step or submit button is ambiguous. Review the employer page.")
                action, button = buttons[0]
                # A stale receipt in ANY application frame must not verify this request.
                previous_texts = [frame.locator('body').inner_text() for frame in frames]
                if any(SUCCESS.search(text) for text in previous_texts):
                    raise ApplicationAttention("A confirmation message was already on the page. Check the employer before making another application.")
                if action == "next":
                    if not submit:
                        return finish("needs_attention", "Dry run filled this step. Advancing could send data to the employer, so no next-step or submit button was clicked.", report)
                    if before_submit is None or before_submit() is not True:
                        raise ApplicationAttention("This request no longer has current authorization to advance the employer form.")
                    verify_expected()
                    submitted = True  # Some ATS save a partial application on Continue.
                    button.click()
                    page.wait_for_timeout(600)
                    continue
                if not submit:
                    return finish("needs_attention", "Dry run complete: the form was filled but not submitted. Review the agent report before enabling submission.", report)
                if before_submit is None or before_submit() is not True:
                    raise ApplicationAttention("This request no longer has current submission authorization. Review it in CyberApply.")
                verify_expected()
                # Authorization is checked immediately before the irreversible click.
                for frame in frames:
                    if frame.locator('input:invalid:visible, textarea:invalid:visible, select:invalid:visible').count():
                        raise ApplicationAttention("A required answer changed before submission. Review the form.")
                submitted = True  # A timed-out click may still have delivered a POST.
                button.click()
                page.wait_for_timeout(1200)
                validate_public_url(page.url, hosts, resolver)
                if blocked:
                    return finish("uncertain", "The employer may have received the application, but a redirect prevented confirmation. Check before retrying.", report)
                texts = [f.locator('body').inner_text() for f in page.frames if f.url not in ('about:blank','')]
                confirmation = next((SUCCESS.search(t) for t in texts if SUCCESS.search(t)), None)
                if confirmation:
                    text = confirmation.group(0)
                    return finish("applied", "The employer displayed an application confirmation.", report, receipt=text, evidence={"url":page.url,"text":text})
                return finish("uncertain", "Submit was clicked, but no explicit employer confirmation was found. Check the employer or inbox before retrying.", report)
            raise ApplicationAttention("This application exceeded the six-step limit. Please review it yourself.")
    except (ApplicationAttention,RecoveryStopped) as exc:
        return finish("uncertain" if submitted else "needs_attention", str(exc), report)
    except Exception:
        return finish("uncertain" if submitted else "failed", "The browser stopped after a possible submission; check the employer before retrying." if submitted else "The browser could not finish this form. No submission was attempted.", report)
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
