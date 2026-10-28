"""Bounded CV application browser. Employer pages are data, never instructions.

Only an explicit ``submit=True`` permits the final submission. Unknown required
questions and uncertain outcomes are returned to the user rather than guessed.
"""
from __future__ import annotations

import hashlib
import ipaddress
import re
import socket
from urllib.parse import urlsplit


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
            raise ApplicationAttention(f"The destination {host} needs approval before the agent can continue.")
        addresses = resolver(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ValueError()
        return host
    except ApplicationAttention:
        raise
    except (ValueError, OSError, TypeError):
        raise ApplicationAttention("A public HTTPS employer address is required.") from None


INSPECT = """() => {
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled;
  return [...document.querySelectorAll('input,textarea,select,[role=combobox],[role=radio],[role=checkbox]')]
    .filter(visible).filter(e => !['hidden','submit','button','reset'].includes(e.type))
    .slice(0,101).map((e,i) => {
      const id='cyberapply-'+i; e.setAttribute('data-cyberapply-field',id);
      const labels=[...(e.labels||[])].map(l=>l.innerText).join(' ');
      const labelled=(e.getAttribute('aria-labelledby')||'').split(/\\s+/).map(x=>document.getElementById(x)?.innerText||'').join(' ');
      const optionLabel=(labels||e.getAttribute('aria-label')||labelled||e.placeholder||e.name||e.id||'Unlabelled field').trim().slice(0,1000);
      const type=e.tagName==='SELECT'?'select':e.tagName==='TEXTAREA'?'textarea':e.getAttribute('role')||e.type||'text';
      const groupParent=e.closest('fieldset,[role=radiogroup]');
      const groupQuestion=(groupParent?.querySelector(':scope > legend')?.innerText||groupParent?.getAttribute('aria-label')||
        (groupParent?.getAttribute('aria-labelledby')||'').split(/\\s+/).map(x=>document.getElementById(x)?.innerText||'').join(' ')).trim();
      const peers=type==='radio'&&e.name?[...document.querySelectorAll('input[type=radio]')].filter(x=>visible(x)&&x.name===e.name&&x.form===e.form):[];
      const label=type==='radio'&&groupQuestion?groupQuestion:optionLabel;
      return {id,label,type,optionLabel,optionValue:e.value||'',group:type==='radio'?((e.name||e.id)+'@'+[...document.forms].indexOf(e.form)):'',groupQuestion,
        nativeControl:['INPUT','SELECT','TEXTAREA'].includes(e.tagName),
        required:e.required||e.getAttribute('aria-required')==='true',
        options:e.options?[...e.options].map(o=>o.text):peers.map(x=>[...(x.labels||[])].map(l=>l.innerText).join(' ').trim()),
        value:e.value||'',checked:e.checked||e.getAttribute('aria-checked')==='true'};
    });
}"""

SUCCESS = re.compile(r"(?:your application (?:has been |was )?(?:successfully )?(?:submitted|received)|thank you for applying|application (?:successfully submitted|received successfully)|we(?:'|’)ve received your application)", re.I)


def _result(status, message, report=None, **kwargs):
    return {"status": status, "message": message, **({"report": report} if report else {}), **kwargs}


def execute_application(payload, cv_bytes, *, submit=False, allowed_hosts=(), playwright_factory=None,
                        research_fn=None, planner=None, resolver=socket.getaddrinfo, timeout=15000, before_submit=None,
                        browser_channel=None):
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
    try:
        cv = payload.get("cv") or {}
        if not cv_bytes or len(cv_bytes) > 15_000_000 or hashlib.sha256(cv_bytes).hexdigest() != cv.get("sha256"):
            raise ApplicationAttention("The selected CV bytes do not match this Apply request. Choose the CV again.")
        job = payload.get("job") or {}
        url = job.get("applyUrl") or job.get("url") or ""
        original_host = validate_public_url(url, resolver=resolver)
        hosts = {original_host, *(str(x).lower().rstrip('.') for x in allowed_hosts)}
        pins = []
        for host in hosts:
            validate_public_url("https://" + host, resolver=resolver)
            addresses = resolver(host,443,type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
                raise ApplicationAttention('The employer address changed to a non-public network.')
            address = next((row[4][0] for row in addresses if ':' not in row[4][0]), addresses[0][4][0])
            pins.append(f"MAP {host} {'[' + address + ']' if ':' in address else address}")
        report["research"] = research_fn(payload)
        if playwright_factory is None:
            from playwright.sync_api import sync_playwright
            playwright_factory = sync_playwright
        with playwright_factory() as runtime:
            browser = runtime.chromium.launch(headless=True, args=['--no-proxy-server','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules='+', '.join(pins)],
                                               **({'channel':browser_channel} if browser_channel else {}))
            context = browser.new_context(accept_downloads=False, service_workers="block")
            # Job forms need HTTP, not arbitrary peer/socket transports that bypass
            # request routing. Apply this before any page or iframe script executes.
            context.route_web_socket('**/*',lambda websocket:websocket.close())
            context.add_init_script("""(() => {
              for (const name of ['WebSocket','WebTransport','RTCPeerConnection','webkitRTCPeerConnection']) {
                Object.defineProperty(globalThis,name,{value:class {
                  constructor(){throw new Error('This network transport is unavailable in the application agent.');}
                },writable:false,configurable:false});
              }
            })();""")
            blocked = []

            def guard(route):
                nonlocal submitted
                req = route.request
                try:
                    # Every network destination is explicitly allowed and DNS-pinned,
                    # including scripts and images. Add required ATS/CDN hosts explicitly.
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
                    blocked.append(req.url.split('?')[0])
                    route.abort()

            context.route("**/*", guard)
            page = context.new_page()
            page.set_default_timeout(timeout)
            page.goto(url, wait_until="domcontentloaded", timeout=timeout * 2)
            page.wait_for_timeout(700)
            seen_steps = set()
            for _step in range(6):
                validate_public_url(page.url, hosts, resolver)
                if blocked:
                    raise ApplicationAttention("An employer redirect or request needs an additional approved host. Review the destination before continuing.")
                frames = []
                for frame in page.frames:
                    if frame.url in ("about:blank", ""):
                        continue
                    validate_public_url(frame.url, hosts, resolver)
                    frames.append(frame)
                fields, controls = [], {}
                for fidx, frame in enumerate(frames):
                    if frame.locator('input[type="password"]:visible').count():
                        raise ApplicationAttention("The employer requires sign-in. Complete it yourself before continuing.")
                    if frame.locator('[data-sitekey]:visible, iframe[src*="recaptcha"]:visible, iframe[src*="hcaptcha"]:visible, iframe[src*="challenges.cloudflare.com"]:visible').count():
                        raise ApplicationAttention("The employer requires a verification challenge. Please complete it yourself.")
                    for field in frame.evaluate(INSPECT):
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
                signature = tuple((f["id"], f["label"], f["type"]) for f in fields)
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
                    if field['type']=='checkbox' and len(same_question)!=1:
                        return False
                    if field['type']=='radio' and len({f.get('group') for f in same_question})!=1:
                        return False
                    return answer and answer.get('source')=='user_confirmed' and any(
                        normalize(item.get('question',''))==normalize(field['label']) and (
                            str(item.get('value',''))==str(answer['value']) or
                            field['type']=='checkbox' and answer['value']=='true' and normalize(item.get('value','')) in {'true','yes','i agree'}
                        ) for item in payload.get('confirmedAnswers',[]) if isinstance(item,dict))
                for field in fields:
                    control = controls[field["id"]]
                    kind, label = field["type"], field["label"].lower()
                    if kind == "file":
                        if re.search(r"cover.?letter", label):
                            if not report["cover_letter"]:
                                unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"No grounded cover letter was prepared."})
                            else:
                                control.set_input_files({"name":"cover-letter.txt","mimeType":"text/plain","buffer":report["cover_letter"].encode()})
                                expected_values[field['id']]=('file',{'name':'cover-letter.txt','size':len(report['cover_letter'].encode())})
                        elif re.search(r"resume|résumé|\bcv\b", label):
                            name = str(cv.get("name") or "CV.pdf").replace('\\','/').split('/')[-1]
                            control.set_input_files({"name":name,"mimeType":cv.get("type") or "application/octet-stream","buffer":cv_bytes})
                            expected_values[field['id']]=('file',{'name':name,'size':len(cv_bytes)})
                        elif field["required"]:
                            unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"This required attachment is not the selected CV."})
                        continue
                    answer = answers.get(field["id"])
                    if kind == 'checkbox':
                        if exact_confirmed(field,answer) and answer['value']=='true' and field.get('nativeControl'):
                            control.set_checked(True)
                            expected_values[field['id']]=('checked',True)
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
                        if exact_confirmed(field,answer) and field.get('nativeControl') and field.get('groupQuestion') and field['options'].count(str(answer['value']))==1:
                            if str(answer['value'])==field.get('optionLabel'):
                                control.check()
                                expected_values[field['id']]=('checked',True)
                                report['answers'].append({**answer, 'question':field['label']})
                            handled_confirmed.add(field['id'])
                        elif field['required']:
                            unresolved.append({'field_id':field['id'],'question':field['label'],'reason':'This required radio question needs an explicit matching choice.'})
                        elif field.get('checked'):
                            if not field.get('nativeControl'):
                                raise ApplicationAttention('The employer preselected an optional personal choice. Review it before applying.')
                            control.evaluate("e=>{e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}")
                        if not exact_confirmed(field,answer) and not field['required'] and field.get('nativeControl'):
                            expected_values[field['id']]=('checked',False)
                        continue
                    if kind == "combobox":
                        if field["required"]:
                            unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"This choice needs explicit user review; consent and personal answers are never assumed."})
                        continue
                    if answer:
                        value = str(answer["value"])
                        if kind == "select":
                            if value not in field["options"]:
                                raise ApplicationAttention("A suggested answer does not match the employer's available choices.")
                            control.select_option(label=value)
                            expected_values[field['id']]=('select',value)
                        elif kind in ("text", "email", "tel", "url", "number", "textarea", "search", "date"):
                            control.fill(value)
                            expected_values[field['id']]=('value',value)
                        else:
                            unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"This control is not supported."})
                        report["answers"].append({**answer, "question":field["label"]})
                    elif field["required"]:
                        unresolved.append({"field_id":field["id"],"question":field["label"],"reason":"The CV does not establish an answer."})
                # De-duplicate and ignore planner file omissions once the exact CV was uploaded.
                def verify_expected():
                    for field_id,(kind,expected) in expected_values.items():
                        control=controls[field_id]
                        actual=(control.is_checked() if kind=='checked' else
                            control.evaluate("e=>e.files?.[0]?{name:e.files[0].name,size:e.files[0].size}:null") if kind=='file' else
                            control.evaluate("e=>e.selectedOptions[0]?.text||''") if kind=='select' else control.input_value())
                        if actual!=expected:
                            raise ApplicationAttention('An answer or attachment changed after preparation. Review the form before applying.')
                report["unresolved"] = list({x["field_id"]:x for x in unresolved if x['field_id'] not in handled_confirmed and not any(f["id"]==x["field_id"] and f["type"]=="file" and re.search(r"resume|résumé|\bcv\b|cover.?letter", f["label"],re.I) for f in fields)}.values())
                if report["unresolved"]:
                    return _result("uncertain" if submitted else "needs_attention", "The employer may have saved a partial application before requesting more answers. Check its status before retrying; review the agent report." if submitted else "The form needs answers or choices that the CV cannot establish. Review the saved agent report.", report)
                page.wait_for_timeout(300)
                refreshed = [(fidx, f) for fidx, frame in enumerate(frames) for f in frame.evaluate(INSPECT)]
                refreshed_signature = tuple((f'{idx}:{f["id"]}', f['label'], f['type']) for idx, f in refreshed)
                if refreshed_signature != signature:
                    continue  # A selection revealed new questions; inspect them before any click.
                verify_expected()
                for frame in frames:
                    if frame.locator('input:invalid:visible, textarea:invalid:visible, select:invalid:visible').count():
                        raise ApplicationAttention("The employer rejected a field value or revealed another required answer. Review the form.")
                buttons = []
                for frame in frames:
                    candidates = frame.locator('button:visible, input[type="submit"]:visible, input[type="button"]:visible')
                    for i in range(candidates.count()):
                        item = candidates.nth(i)
                        if item.is_enabled():
                            text = (item.inner_text() if item.evaluate("e=>e.tagName") != "INPUT" else item.get_attribute('value') or '').strip()
                            if re.fullmatch(r"(?:submit(?: application)?|send application|apply(?: now)?|complete application)",text,re.I):
                                buttons.append(("submit", item))
                            elif re.fullmatch(r"(?:next|continue|next step|review application)",text,re.I):
                                buttons.append(("next", item))
                if len(buttons) != 1:
                    raise ApplicationAttention("The next step or submit button is ambiguous. Review the employer page.")
                action, button = buttons[0]
                # A stale receipt in ANY application frame must not verify this request.
                previous_texts = [frame.locator('body').inner_text() for frame in frames]
                if any(SUCCESS.search(text) for text in previous_texts):
                    raise ApplicationAttention("A confirmation message was already on the page. Check the employer before making another application.")
                if action == "next":
                    if not submit:
                        return _result("needs_attention", "Dry run filled this step. Advancing could send data to the employer, so no next-step or submit button was clicked.", report)
                    if before_submit is None or before_submit() is not True:
                        raise ApplicationAttention("This request no longer has current authorization to advance the employer form.")
                    verify_expected()
                    submitted = True  # Some ATS save a partial application on Continue.
                    button.click()
                    page.wait_for_timeout(600)
                    continue
                if not submit:
                    return _result("needs_attention", "Dry run complete: the form was filled but not submitted. Review the agent report before enabling submission.", report)
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
                    return _result("uncertain", "The employer may have received the application, but a redirect prevented confirmation. Check before retrying.", report)
                texts = [f.locator('body').inner_text() for f in page.frames if f.url not in ('about:blank','')]
                confirmation = next((SUCCESS.search(t) for t in texts if SUCCESS.search(t)), None)
                if confirmation:
                    text = confirmation.group(0)
                    return _result("applied", "The employer displayed an application confirmation.", report, receipt=text, evidence={"url":page.url,"text":text})
                return _result("uncertain", "Submit was clicked, but no explicit employer confirmation was found. Check the employer or inbox before retrying.", report)
            raise ApplicationAttention("This application exceeded the six-step limit. Please review it yourself.")
    except ApplicationAttention as exc:
        return _result("uncertain" if submitted else "needs_attention", str(exc), report)
    except Exception:
        return _result("uncertain" if submitted else "failed", "The browser stopped after a possible submission; check the employer before retrying." if submitted else "The browser could not finish this form. No submission was attempted.", report)
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
