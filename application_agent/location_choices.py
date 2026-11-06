"""Read-only employer country/city choices: no application claim, facts or files."""
import ipaddress
import re
import socket
from urllib.parse import urlsplit

from .browser import (INSPECT, APPLICATION_HOST_GROUPS, CITY_LOOKUP_HOST, ApplicationAttention,
                      automatic_application_hosts, static_asset_hosts, allowed_static_asset,
                      allowed_city_lookup, validate_public_url, restrict_transports)
from .combobox import capture_combobox_options
from .journey import greenhouse_source, matching_greenhouse_embed

LOCATION = re.compile(r'^(?:country|(?:location\s*\(?\s*)?city\)?|location)\s*\*?$', re.I)


def inspect_location_choices(task, *, playwright_factory=None, resolver=socket.getaddrinfo,
                             browser_channel='chrome', timeout=15000):
    """Open a fresh blank form, read linked menus, close. All writes are blocked."""
    browser = context = None
    try:
        job=task.get('job') or {};source=greenhouse_source(job)
        if not source:raise ApplicationAttention('Unsupported location source.')
        query=task.get('cityQuery','')
        if not isinstance(query,str) or len(query)>120 or re.search(r'[\r\n\x00-\x1f:/@]',query):
            raise ApplicationAttention('Invalid city search.')
        url=job.get('applyUrl') or job.get('url') or ''
        original=validate_public_url(url,resolver=resolver)
        assets=static_asset_hosts(job)
        hosts={original,*automatic_application_hosts(job)}
        reads={CITY_LOOKUP_HOST} if query else set()
        pinned=[]
        for host in sorted(hosts|assets|reads):
            validate_public_url('https://'+host,resolver=resolver)
            addresses=resolver(host,443,type=socket.SOCK_STREAM)
            if any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):raise ApplicationAttention('Invalid address.')
            address=next((a[4][0] for a in addresses if ':' not in a[4][0]),addresses[0][4][0])
            pinned.append(f"MAP {host} {'['+address+']' if ':' in address else address}")
        if playwright_factory is None:
            from playwright.sync_api import sync_playwright
            playwright_factory=sync_playwright
        with playwright_factory() as runtime:
            browser=runtime.chromium.launch(headless=True,args=['--no-proxy-server','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules='+', '.join(pinned)],**({'channel':browser_channel} if browser_channel else {}))
            context=browser.new_context(accept_downloads=False,service_workers='block')
            restrict_transports(context)
            def guard(route):
                request=route.request
                # This lane cannot upload, autosave, log in, Continue or Submit.
                if request.method not in {'GET','HEAD'}:route.abort();return
                try:
                    host=(urlsplit(request.url).hostname or '').lower()
                    validate_public_url(request.url,hosts|assets|reads,resolver)
                    if request.resource_type=='document':
                        address=urlsplit(request.url)
                        canonical=host in APPLICATION_HOST_GROUPS[0] and address.path.rstrip('/')==f'/{source["board"]}/jobs/{source["posting"]}' and not address.query
                        if request.url!=url and not canonical and not matching_greenhouse_embed(request.url,source):raise ApplicationAttention('Unrelated navigation blocked.')
                    if host in reads:
                        if not allowed_city_lookup(request.url,request.method,request.resource_type,'job-boards.greenhouse.io',{'city':query}):raise ApplicationAttention('Unsupported lookup.')
                    elif host in assets:
                        if not allowed_static_asset(request.url,request.method,request.resource_type,assets):raise ApplicationAttention('Unsupported asset.')
                    elif request.resource_type=='document' and urlsplit(request.url).path=='/embed/job_app' and not matching_greenhouse_embed(request.url,source):
                        raise ApplicationAttention('Wrong vacancy embed.')
                    route.continue_()
                except ApplicationAttention:route.abort()
            context.route('**/*',guard)
            page=context.new_page();page.set_default_timeout(timeout)
            page.goto(url,wait_until='domcontentloaded',timeout=timeout*2)
            page.wait_for_timeout(700)
            # Some company pages load a signed board embed rather than a direct form.
            if original not in APPLICATION_HOST_GROUPS[0]:
                for _ in range(4):
                    embeds=[src for src in page.locator('iframe[src]').evaluate_all('nodes=>nodes.map(n=>n.src)') if matching_greenhouse_embed(src,source)]
                    if len(set(embeds))==1:
                        page.goto(embeds[0],wait_until='domcontentloaded',timeout=timeout*2);page.wait_for_timeout(700);break
                    page.wait_for_timeout(250)
            questions=[]
            for frame in page.frames:
                address=urlsplit(frame.url)
                if (address.hostname or '').lower() not in APPLICATION_HOST_GROUPS[0]:continue
                if not (matching_greenhouse_embed(frame.url,source) or address.path.rstrip('/')==f'/{source["board"]}/jobs/{source["posting"]}'):continue
                validate_public_url(frame.url,hosts,resolver)
                try:frame.locator('[role="combobox"],select').first.wait_for(state='visible',timeout=min(timeout,7000))
                except Exception:continue
                fields=frame.evaluate(INSPECT)
                for field in fields:
                    if len(questions)>=12:break
                    if field['type'] not in {'select','combobox'} or not LOCATION.fullmatch(field['label']):continue
                    control=frame.locator(f'[data-cyberapply-field="{field["id"]}"]')
                    city=bool(re.search(r'\bcity\b|^location\s*\*?$',field['label'],re.I)) and not field.get('phoneCountry')
                    if city and query and control.evaluate("e=>e.tagName==='INPUT'&&!e.readOnly"):
                        control.fill(query,timeout=timeout)
                    choices=field.get('options') or capture_combobox_options(frame,control,2500,400)
                    questions.append({'question':field['label'],'field_type':field['type'],'options':choices[:400],
                                      'optionsTruncated':len(choices)>400,'phoneCountry':bool(field.get('phoneCountry')),
                                      **({'lookupQuery':query} if city and query else {})})
            return {'questions':questions,'code':'' if any(q['options'] for q in questions) else 'no_results'}
    except Exception:
        return {'questions':[],'code':'unavailable'}
    finally:
        if context:
            try:context.close()
            except Exception:pass
        if browser:
            try:browser.close()
            except Exception:pass


def run_location_capture(site,token,call_site,site_access_token=None,browser_channel='chrome',on_state=None):
    """Dedicated menu leases cannot turn into application claims."""
    task=call_site(site,token,'/api/application-agent/location-choices/claim',{'version':1},site_access_token=site_access_token).get('task')
    if not task:return False
    if on_state:on_state('working')
    result=inspect_location_choices(task,browser_channel=browser_channel)
    call_site(site,token,'/api/application-agent/location-choices/result',{'applicationId':task['applicationId'],'captureId':task['captureId'],**result},site_access_token=site_access_token)
    return True
