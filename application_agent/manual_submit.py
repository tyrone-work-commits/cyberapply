"""Observe an owner-submitted form in the exact filled browser. Never click Submit."""
import re
import sys
import time
from urllib.parse import urlsplit, urlencode
from uuid import uuid4
from .employer_verification import observed_recaptcha_error, recaptcha_resource


def protected_form(page, greenhouse=False):
    if greenhouse:return True
    for frame in page.frames:
        try:
            if recaptcha_resource(frame.url) or frame.locator('script[src*="/recaptcha/"],iframe[src*="/recaptcha/"],.g-recaptcha,[data-recaptcha],[name="g-recaptcha-response"]').count():return True
            if frame.evaluate("()=>!!window.grecaptcha||[...document.scripts].some(s=>/grecaptcha|recaptcha/i.test(s.textContent||''))||/protected by recaptcha/i.test(document.body?.innerText||'')"):return True
        except Exception:pass
    return False


def confirmation_url(before, current):
    """Only a new same-board, same-vacancy Greenhouse confirmation path."""
    old,new=urlsplit(before),urlsplit(current)
    hosts={'boards.greenhouse.io','job-boards.greenhouse.io','boards.eu.greenhouse.io','job-boards.eu.greenhouse.io'}
    match=re.fullmatch(r'/([^/]+)/jobs/(\d+)/?',old.path)
    return bool(match and new.scheme=='https' and old.hostname in hosts and new.hostname in hosts and not new.username and not new.password and new.port in (None,443) and re.fullmatch(re.escape('/'+match[1]+'/jobs/'+match[2])+r'/(?:confirmation|thank_you)/?',new.path))


def notify_ready():
    """A normal silent Windows toast. No custom sound, applicant data or secrets."""
    if sys.platform!='win32':return False
    import subprocess
    script="""[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null
    [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] > $null
    $xml=New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>CyberApply — ready to submit</text><text>Open the CyberApply browser window and press Submit. Complete reCAPTCHA yourself.</text></binding></visual><audio silent="true"/></toast>')
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('CyberApply').Show([Windows.UI.Notifications.ToastNotification]::new($xml))"""
    try:
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',script],creationflags=subprocess.CREATE_NO_WINDOW,timeout=15,capture_output=True)
        return result.returncode==0
    except Exception:return False


HUMAN_EVENTS="""()=>{if(window.__cyberapplyManualObserver)return;window.__cyberapplyManualObserver=true;window.__cyberapplyManualSubmitCount=0;
 document.addEventListener('click',e=>{const b=e.target.closest('button,input[type=submit]');if(e.isTrusted&&b&&/^(submit(?: application)?|send application|apply(?: now)?|complete application)$/i.test((b.innerText||b.value||'').trim()))window.__cyberapplyManualSubmitCount++;},true);
 document.addEventListener('submit',e=>{if(e.isTrusted)window.__cyberapplyManualSubmitCount=Math.max(1,window.__cyberapplyManualSubmitCount);},true);
}"""


class ManualSubmit:
    def __init__(self,call,task,notify=notify_ready):
        self.call=call;self.ids={k:task[k] for k in ('requestId','claimId')};self.id=str(uuid4());self.active=False
        self.notify=notify;self.delivery=False;self.human_attempts=0;self.authorized=True

    def window(self,context,page):
        from .verification_handoff import BrowserHandoff
        BrowserHandoff.window(self,context,page,'normal')

    def wait(self,context,page,report,journey,hosts,success,recaptcha=None,watch=None):
        self.active=True;initial=page.url;session=None;state='ready';last_poll=0;last_event=None
        # Observe only event counts, never CAPTCHA values/tokens. No click is performed here.
        context.add_init_script('('+HUMAN_EVENTS+')()')
        for frame in page.frames:
            if (urlsplit(frame.url).hostname or '').lower() in hosts:
                try:frame.evaluate(HUMAN_EVENTS)
                except Exception:pass
        try:self.window(context,page);report['manual_submission']={'policy':'user_final_submit','window':'visible','notification_sent':self.notify(),'state':state}
        except Exception:report['manual_submission']={'policy':'user_final_submit','window':'foreground_unavailable','notification_sent':self.notify(),'state':state}
        # Snapshot may be retried idempotently; neither this loop nor any callback submits.
        endpoint='/api/application-agent/manual-submit'
        pending_evidence=None;closed=False
        while True:
            if getattr(self,'window_control',None):self.window_control.check()
            closed=page.is_closed()
            frames=[] if closed else [f for f in page.frames if (urlsplit(f.url).hostname or '').lower() in hosts]
            for frame in frames:
                try:self.human_attempts=max(self.human_attempts,int(frame.evaluate('()=>window.__cyberapplyManualSubmitCount||0')))
                except Exception:pass
            journey.data['manual_submit_observed']=self.delivery or self.human_attempts>0
            journey.data['possible_delivery']=journey.data.get('possible_delivery',False) or self.delivery
            journey.data['human_submit_observed']=self.human_attempts
            if self.delivery or self.human_attempts:
                for frame in frames:
                    try:
                        found=success.search(frame.locator('body').inner_text(timeout=1500))
                        if found:pending_evidence={'url':frame.url,'text':found.group(0)};break
                        if confirmation_url(initial,frame.url):pending_evidence={'url':frame.url,'text':'Employer displayed the vacancy-specific application confirmation page.'};break
                    except Exception:pass  # Navigation can temporarily replace the document.
            try:error=observed_recaptcha_error(frames) if frames else False
            except Exception:error=False
            if error:state='needs_submit'
            report['manual_submission']['state']='confirmed' if pending_evidence else state
            report['manual_submission']['human_submit_observed']=self.human_attempts
            now=time.monotonic()
            if now-last_poll>=2 or pending_evidence or closed:
                event='confirmed' if pending_evidence else 'cancelled' if closed else 'ready' if session is None else 'needs_submit' if state=='needs_submit' and session.get('state')!='needs_submit' else 'poll'
                # Keep the main report small enough for the bounded endpoint. No CV bytes.
                snapshot={k:report[k] for k in ('journey','manual_submission','unresolved','submission_control') if k in report}
                try:
                    result=self.call(endpoint,{**self.ids,'id':self.id,'event':event,'challengeHosts':sorted(recaptcha.pending) if recaptcha else [],'report':snapshot,**({'evidence':pending_evidence} if pending_evidence else {})})
                    session=result['session'];last_event=event
                    report['manual_submission'].pop('connection',None)
                    if pending_evidence and session['state']=='confirmed':return {'status':'applied','message':'The employer displayed confirmation after you submitted.','receipt':pending_evidence['text'],'evidence':pending_evidence}
                    if session['state'] in {'cancel_requested','cancelled'} or closed:
                        report['manual_submission']['state']='cancelled'
                        return {'status':'uncertain','message':'Manual submission was cancelled or the browser was closed. No automatic retry will be made; check the employer outcome before trying again.'}
                    if recaptcha:
                        newly=set(session.get('approvedHosts',[]))-recaptcha.approved
                        recaptcha.approved.update(session.get('approvedHosts',[]));recaptcha.pending.difference_update(recaptcha.approved)
                        if newly:recaptcha.restore(page)
                    if session.get('openRequested'):
                        try:self.window(context,page)
                        except Exception:pass
                except Exception:
                    # Temporary HTTP, token, or desktop connectivity failures do not
                    # close/refresh/recreate the filled browser or replay any action.
                    report['manual_submission']['connection']='waiting_to_reconnect'
                last_poll=now
            if closed:
                time.sleep(1)
            else:
                try:
                    if watch:watch.capture()
                    page.wait_for_timeout(500)
                except Exception:time.sleep(.5)
