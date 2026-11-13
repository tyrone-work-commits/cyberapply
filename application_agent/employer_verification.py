"""Detect employer verification blockers without solving or inspecting tokens."""
import re
from urllib.parse import urlsplit

RECAPTCHA_HOSTS={'www.google.com','www.recaptcha.net','www.gstatic.com'}


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

    def permit(self,request):
        if not recaptcha_resource(request.url):return None
        host=urlsplit(request.url).hostname
        if host in self.approved and host in self.pins:
            if request.method in {'GET','HEAD','OPTIONS'} and request.resource_type in {'script','document','stylesheet','image','font'}:return True
            if request.method in {'GET','POST','HEAD','OPTIONS'} and recaptcha_resource(request.frame.url):return True
        self.pending.update(self.pins)
        if request.method=='GET' and request.resource_type in {'script','document'} and len(self.resources)<10:self.resources[request.url]=request.resource_type
        return False

    def restore(self,page):
        # Only observed failed bootstrap resources; never reload the employer form.
        for url,kind in list(self.resources.items()):
            if urlsplit(url).hostname not in self.approved:continue
            if kind=='script':
                page.evaluate("""url=>{for(const old of document.querySelectorAll('script[src]'))if(old.src===url){const s=document.createElement('script');for(const a of old.attributes)s.setAttribute(a.name,a.value);old.replaceWith(s);break;}}""",url)
            else:
                for element in page.locator('iframe[src]').all():
                    if element.evaluate('e=>e.src')!=url:continue
                    handle=element.element_handle();frame=handle.content_frame() if handle else None
                    if frame and frame!=page.main_frame:
                        try:frame.goto(url,wait_until='domcontentloaded',timeout=5000)
                        except Exception:pass
        self.resources.clear()
