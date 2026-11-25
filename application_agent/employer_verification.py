"""Detect employer verification blockers without solving or inspecting tokens."""
import re
from urllib.parse import urlsplit

RECAPTCHA_HOSTS={'www.google.com','www.recaptcha.net','www.gstatic.com','recaptcha.google.com'}


def recaptcha_resource(url):
    """Classification only. This never grants a destination network access."""
    try:
        parsed=urlsplit(url)
        return bool(parsed.scheme=='https' and not parsed.username and not parsed.password
            and parsed.port in (None,443)
            and parsed.hostname in RECAPTCHA_HOSTS
            and parsed.path.startswith('/recaptcha/'))
    except (TypeError,ValueError):return False


def recaptcha_error(text):
    # A normal privacy badge or a job description mentioning CAPTCHA is not an error.
    return any(re.search(pattern,str(text)[:200000],re.I) for pattern in (
        r'\bplease\s+complete\s+(?:the\s+)?re\s*captcha\b',
        r'\bre\s*captcha\s+(?:verification\s+)?(?:failed|failure|error|expired|is\s+(?:invalid|required|missing))\b',
        r'\b(?:invalid|missing|expired|failed)\s+re\s*captcha\b',
        r'\b(?:complete|solve)\s+(?:the\s+)?re\s*captcha\s+(?:before|to|and)\s+(?:resubmit|submit|continue)\b',
    ))


def record_recaptcha(report,phase,state):
    report['employer_verification']={'service':'recaptcha','phase':phase,'state':state,
        'manual_required':True,'submission_replayed':False}
    if phase in {'after_submit','after_continue'}:
        if state=='resource_blocked':
            return 'The employer reCAPTCHA connection was blocked after '+('Submit' if phase=='after_submit' else 'Continue')+'. Completion remains unverified. No action was repeated; check the employer outcome before any retry.'
        return 'The employer displayed a reCAPTCHA verification error after '+('Submit' if phase=='after_submit' else 'Continue')+'. No action was repeated. Complete the employer check yourself and verify the application outcome before any retry.'
    if state=='resource_blocked':
        return 'The employer reCAPTCHA could not load within the agent\'s approved destinations. Submit was not clicked. This requires a permitted verification connection and a personal check; changing CV answers cannot fix it.'
    return 'The employer requires reCAPTCHA verification. Submit was not clicked. Complete that check personally; changing CV answers cannot resolve it.'


def observed_recaptcha_error(frames):
    return any(recaptcha_error(frame.locator('body').inner_text()) for frame in frames)


def visible_recaptcha_challenge(frames):
    # A persistent privacy badge / anchor is not itself an unfinished image check.
    return any(frame.locator('iframe[src*="/recaptcha/"][src*="/bframe"]:visible').count() for frame in frames)


class RecaptchaAccess:
    """Narrow, session-consented native widget traffic. Never a CAPTCHA solver."""
    def __init__(self,pins):
        self.pins=set(pins);self.approved=set();self.pending=set();self.resources={}
        self.allowed=0;self.blocked=0;self.events={}

    def _diagnostic(self,request,outcome,status=None,error=None):
        # Only fixed categories and public provider hosts. Never retain a URL,
        # query, token, request/response body, headers or applicant data.
        try:
            host=urlsplit(request.url).hostname
            if host not in RECAPTCHA_HOSTS:return
            method=request.method if request.method in {'GET','HEAD','OPTIONS','POST'} else 'other'
            kind=request.resource_type if request.resource_type in {'script','document','stylesheet','image','font','fetch','xhr'} else 'other'
            origin='widget' if recaptcha_resource(request.frame.url) else 'employer'
            key=(host,method,kind,origin,outcome,status,error)
            if key not in self.events and len(self.events)>=24:return
            self.events[key]=min(1000000,self.events.get(key,0)+1)
        except Exception:pass

    def summary(self):
        return {'allowed':self.allowed,'blocked':self.blocked,'events':[
            {'host':host,'method':method,'resource_type':kind,'context':origin,'outcome':outcome,'count':count,
             **({'status':status} if status is not None else {}),**({'error':error} if error else {})}
            for (host,method,kind,origin,outcome,status,error),count in self.events.items()]}

    def observe_response(self,response):
        try:
            if recaptcha_resource(response.url) and 400<=response.status<=599:
                self._diagnostic(response.request,'http_error',status=response.status)
        except Exception:pass

    def observe_failure(self,request):
        try:
            if recaptcha_resource(request.url):
                failure=request.failure
                known={'net::ERR_ABORTED','net::ERR_FAILED','net::ERR_NAME_NOT_RESOLVED','net::ERR_CONNECTION_RESET','net::ERR_CONNECTION_CLOSED','net::ERR_CONNECTION_TIMED_OUT','net::ERR_TIMED_OUT','net::ERR_INTERNET_DISCONNECTED','net::ERR_BLOCKED_BY_CLIENT','net::ERR_CERT_AUTHORITY_INVALID'}
                self._diagnostic(request,'network_error',error=failure if failure in known else 'request_failed')
        except Exception:pass

    def permit(self,request):
        if not recaptcha_resource(request.url):return None
        host=urlsplit(request.url).hostname
        if host in self.approved and host in self.pins:
            readable=request.method in {'GET','HEAD','OPTIONS'} and request.resource_type in {'script','document','stylesheet','image','font','fetch','xhr'}
            widget=request.method in {'GET','POST','HEAD','OPTIONS'} and recaptcha_resource(request.frame.url)
            if readable or widget:
                self.allowed=min(1000000,self.allowed+1);return True
        self.blocked=min(1000000,self.blocked+1)
        self._diagnostic(request,'host_not_pinned' if host not in self.pins else 'approval_required' if host not in self.approved else 'request_not_supported')
        self.pending.update(self.pins)
        if request.method=='GET' and request.resource_type in {'script','document'} and len(self.resources)<10:
            frame=request.frame
            self.resources[(id(frame),request.url)]={'kind':request.resource_type,'frame':frame,'document_url':frame.url,
                'parent':frame.parent_frame if request.resource_type=='document' else None,
                'parent_url':frame.parent_frame.url if request.resource_type=='document' and frame.parent_frame else None}
        return False

    def restore(self,page):
        # Retry only observed failed bootstrap resources in their original
        # document. Never refresh an employer form, inspect a token or Submit.
        outcome={'attempted':0,'restarted':0,'unavailable':0}
        for key,resource in list(self.resources.items()):
            _,url=key
            if urlsplit(url).hostname not in self.approved:continue
            self.resources.pop(key,None);outcome['attempted']+=1
            restarted=False
            try:
                frame=resource['frame']
                if resource['kind']=='script':
                    if frame in page.frames and not frame.is_detached() and frame.url==resource['document_url']:
                        restarted=frame.evaluate("""url=>{for(const old of document.querySelectorAll('script[src]'))if(old.src===url){const s=document.createElement('script');for(const a of old.attributes)s.setAttribute(a.name,a.value);old.replaceWith(s);return true;}return false;}""",url) is True
                else:
                    parent=resource['parent']
                    if parent in page.frames and not parent.is_detached() and parent.url==resource['parent_url']:
                        for element in parent.locator('iframe[src]').all():
                            if element.evaluate('e=>e.src')!=url:continue
                            handle=element.element_handle();target=handle.content_frame() if handle else None
                            if target is frame and target!=page.main_frame and not target.is_detached():
                                target.goto(url,wait_until='domcontentloaded',timeout=5000);restarted=True
                            break
            except Exception:pass  # A disappearing widget must not close/reload the filled form.
            outcome['restarted' if restarted else 'unavailable']+=1
        return outcome
