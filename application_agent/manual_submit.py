"""Observe an owner-submitted form in the exact filled browser. Never click Submit."""
import re
import sys
import time
from urllib.parse import urlsplit, urlencode
from uuid import uuid4
from .employer_verification import observed_recaptcha_error, recaptcha_resource
from .submission_errors import observed_processing_error, submission_http_error


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
    """A normal Windows toast with system sound. No applicant data or secrets."""
    from .desktop_notifications import show_notice
    return show_notice('submit','Open CyberApply Applications to open your prepared browser and press Submit.','manual-ready')


HUMAN_EVENTS="""()=>{if(window.__cyberapplyManualObserver)return;window.__cyberapplyManualObserver=true;window.__cyberapplyManualSubmitCount=0;
 const observed=()=>{window.__cyberapplyManualSubmitCount++;try{window.__cyberapplySubmitObserved?.(window.__cyberapplyManualSubmitCount)?.catch(()=>{});}catch{}};
 document.addEventListener('click',e=>{const b=e.target.closest('button,input[type=submit]');if(e.isTrusted&&b&&/^(submit(?: application)?|send application|apply(?: now)?|complete application)$/i.test((b.innerText||b.value||'').trim()))observed();},true);
 document.addEventListener('submit',e=>{if(e.isTrusted)observed();},true);
}"""


class ManualSubmit:
    def __init__(self,call,task,notify=notify_ready):
        self.call=call;self.ids={k:task[k] for k in ('requestId','claimId')};self.id=str(uuid4());self.active=False
        self.notify=notify;self.delivery=False;self.human_attempts=0;self.authorized=True

    def window(self,context,page):
        from .verification_handoff import BrowserHandoff
        BrowserHandoff.window(self,context,page,'normal')

    def minimize(self,context,page):
        from .verification_handoff import BrowserHandoff
        BrowserHandoff.window(self,context,page,'minimized')

    def wait(self,context,page,report,journey,hosts,success,recaptcha=None,watch=None):
        self.context,self.page=context,page
        control=getattr(self,'window_control',None)
        if callable(getattr(control,'suspend',None)):control.suspend()
        browser_session=getattr(control,'session_id',self.id)
        opened_command=None;open_error=None
        self.active=True;initial=page.url;session=None;state='ready';last_poll=0;last_event=None
        # Observe only event counts, never CAPTCHA values/tokens. No click is performed here.
        def observed(source,count):
            if source.get('page') is page and isinstance(count,int) and count>0:self.human_attempts=max(self.human_attempts,count)
        context.expose_binding('__cyberapplySubmitObserved',observed)
        context.add_init_script('('+HUMAN_EVENTS+')()')
        for frame in page.frames:
            if (urlsplit(frame.url).hostname or '').lower() in hosts:
                try:frame.evaluate(HUMAN_EVENTS)
                except Exception:pass
        if watch:
            watch.set_control('submit');watch.attach(context,page);watch.capture(force=True)
        # Readiness is a notification, never permission to take foreground.
        try:self.minimize(context,page);window='hidden' if getattr(context,'_cyberapply_visibility',None) else 'minimized'
        except Exception:window='background_unavailable'
        try:notified=self.notify() if self.notify else False
        except Exception:notified=False
        report['manual_submission']={'policy':'user_final_submit','window':window,'notification_sent':notified,'state':state}
        if self.notify is None:report['manual_submission']['notification_delivery']='background_checkin'
        # Snapshot may be retried idempotently; neither this loop nor any callback submits.
        endpoint='/api/application-agent/manual-submit'
        pending_evidence=None;closed=False;processing_error=False;http_error=None
        def response_observed(response):
            nonlocal http_error
            if self.delivery or self.human_attempts:
                status=submission_http_error(response,hosts,page)
                if status is not None:http_error=status
        if callable(getattr(page,'on',None)):page.on('response',response_observed)
        while True:
            # Only this handoff's checkbox-confirmed open command may focus it.
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
            if (self.delivery or self.human_attempts) and observed_processing_error(frames):
                processing_error=True;state='needs_submit'
            if processing_error:
                report['manual_submission']['processing_error']={'code':'employer_processing_error',**({'http_status':http_error} if http_error else {})}
            report['manual_submission']['state']='confirmed' if pending_evidence else state
            report['manual_submission']['human_submit_observed']=self.human_attempts
            if recaptcha and callable(getattr(recaptcha,'summary',None)):
                report['manual_submission']['verification_connection']=recaptcha.summary()
            now=time.monotonic()
            if now-last_poll>=2 or pending_evidence or closed:
                unsent=closed and not self.delivery and self.human_attempts==0 and journey.data.get('continue_click_attempts')==0 and journey.data.get('submit_click_attempts')==0 and journey.data.get('possible_delivery') is False
                event='confirmed' if pending_evidence else ('closed_before_submit' if unsent else 'cancelled') if closed else 'ready' if session is None else 'processing_error' if processing_error and not session.get('processingError') else 'needs_submit' if state=='needs_submit' and session.get('state')!='needs_submit' else 'poll'
                # Keep the main report small enough for the bounded endpoint. No CV bytes.
                snapshot={k:report[k] for k in ('journey','manual_submission','unresolved','submission_control') if k in report}
                try:
                    result=self.call(endpoint,{**self.ids,'id':self.id,'event':event,'browserHealthVersion':1,'browserSessionId':browser_session,**({'openedCommandId':opened_command} if opened_command else {}),**({'openError':open_error} if open_error else {}),'challengeHosts':sorted(recaptcha.pending) if recaptcha else [],**({'submissionHttpStatus':http_error} if event=='processing_error' and http_error else {}),'report':snapshot,**({'evidence':pending_evidence} if pending_evidence else {})})
                    session=result['session'];last_event=event
                    report['manual_submission'].pop('connection',None)
                    if pending_evidence and session['state']=='confirmed':
                        if watch:watch.attach(context,page);watch.set_control('confirmed');watch.capture(force=True)
                        return {'status':'applied','message':'The employer displayed confirmation after you submitted.','receipt':pending_evidence['text'],'evidence':pending_evidence}
                    if closed and session['state']=='closed_before_submit':
                        report['manual_submission']['state']='closed_before_submit'
                        return {'status':'needs_attention','message':'Ready – submit it yourself. The browser closed before Submit. Use the application card to confirm this and reopen with the original CV and saved answers.'}
                    if session['state'] in {'cancel_requested','cancelled'} or closed:
                        report['manual_submission']['state']='cancelled'
                        return {'status':'uncertain','message':'Manual submission was cancelled or the browser was closed. No automatic retry will be made; check the employer outcome before trying again.'}
                    if recaptcha:
                        newly=set(session.get('approvedHosts',[]))-recaptcha.approved
                        recaptcha.approved.update(session.get('approvedHosts',[]));recaptcha.pending.difference_update(recaptcha.approved)
                        if newly:report['manual_submission']['verification_resource_recovery']=recaptcha.restore(page)
                    command=session.get('openCommandId')
                    if session.get('openRequested') and (not command or command!=opened_command):
                        opened_command=command;open_error=None
                        try:
                            self.window(context,page);report['manual_submission']['window']='visible'
                        except Exception:report['manual_submission']['window']='foreground_unavailable';open_error='window_unavailable'
                        # Report the exact Open result before another browser inspection or
                        # recording operation can delay it. Failure retries metadata only
                        # on the normal poll; the same nonce never focuses a second time.
                        if command:
                            try:
                                self.call(endpoint,{**self.ids,'id':self.id,'event':'poll','browserHealthVersion':1,'browserSessionId':browser_session,'openedCommandId':command,**({'openError':open_error} if open_error else {}),'challengeHosts':sorted(recaptcha.pending) if recaptcha else [],'report':{k:report[k] for k in ('journey','manual_submission','unresolved','submission_control') if k in report}})
                            except Exception:report['manual_submission']['connection']='waiting_to_reconnect'
                        if watch and not open_error:
                            try:watch.set_control('manual')
                            except Exception:pass  # Recording failure is not window-opening failure.
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
