"""Owner-controlled, bounded handoff of the existing browser, never a solver."""
import time
from urllib.parse import urlsplit,urlencode
from uuid import uuid4

VERIFICATION_HOSTS={'www.google.com','www.recaptcha.net','www.gstatic.com','js.hcaptcha.com','api.hcaptcha.com','newassets.hcaptcha.com','challenges.cloudflare.com'}
def verification_family(url):
    try:
        u=urlsplit(url)
        if u.scheme!='https' or u.username or u.password or u.port not in (None,443):return set()
        if u.hostname in {'www.google.com','www.recaptcha.net','www.gstatic.com'} and u.path.startswith('/recaptcha/'):
            return {'www.google.com','www.recaptcha.net','www.gstatic.com'}
        if u.hostname=='js.hcaptcha.com' and u.path=='/1/api.js' or u.hostname in {'api.hcaptcha.com','newassets.hcaptcha.com'} and u.path.startswith(('/captcha/','/checksiteconfig','/getcaptcha/','/checkcaptcha/')):
            return {'js.hcaptcha.com','api.hcaptcha.com','newassets.hcaptcha.com'}
        if u.hostname=='challenges.cloudflare.com' and u.path.startswith(('/turnstile/','/cdn-cgi/challenge-platform/')):return {'challenges.cloudflare.com'}
    except ValueError:pass
    return set()

class BrowserHandoff:
    def __init__(self,call,task,clock=time.monotonic):
        self.call=call;self.ids={k:task[k] for k in ('requestId','claimId')};self.clock=clock
        self.active=False;self.approved=set();self.pending=set();self.resources={};self.pins=set();self.turns=0
        self.blocked_navigation=False
    def window(self,context,page,state):
        session=context.new_cdp_session(page)
        try:
            info=session.send('Browser.getWindowForTarget')
            session.send('Browser.setWindowBounds',{'windowId':info['windowId'],'bounds':{'windowState':state}})
            if state=='normal':page.bring_to_front()
        finally:session.detach()
    def challenge_request(self,request):
        family=verification_family(request.url)
        if not family:return None
        host=urlsplit(request.url).hostname
        if host in self.approved and host in self.pins and request.method in {'GET','HEAD','OPTIONS','POST'}:
            # An employer script cannot use approved challenge URLs to POST CV data.
            if request.method=='POST' and not verification_family(request.frame.url):return False
            return True
        self.pending.update(family.intersection(self.pins))
        if request.method=='GET' and request.resource_type in {'script','document'} and len(self.resources)<10:self.resources[request.url]=request.resource_type
        return False
    def _reload_challenge_resources(self,page):
        # Only failed, explicitly approved provider resources; never reload the form.
        for url,kind in list(self.resources.items()):
            if urlsplit(url).hostname not in self.approved:continue
            if kind=='document':
                reloaded=False
                for frame in page.frames:
                    if frame.url==url:
                        try:frame.goto(url,wait_until='domcontentloaded',timeout=5000);reloaded=True
                        except Exception:pass
                if not reloaded:
                    # A blocked child can have a chrome-error URL. Match its
                    # original iframe src; never navigate the application itself.
                    for element in page.locator('iframe[src]').all():
                        if element.evaluate('e=>e.src')!=url:continue
                        frame=element.content_frame()
                        if frame:
                            try:frame.goto(url,wait_until='domcontentloaded',timeout=5000)
                            except Exception:pass
            elif kind=='script':
                page.evaluate("""url=>{for(const old of document.querySelectorAll('script[src]')){if(old.src===url){const s=document.createElement('script');for(const a of old.attributes)s.setAttribute(a.name,a.value);old.replaceWith(s);break;}}}""",url)
        self.resources.clear()
    def __call__(self,context,page,questions,authorize,completed,watch=None,kind='question'):
        if self.turns>=2:return False
        self.turns+=1;pause_id=str(uuid4());self.active=True;self.blocked_navigation=False
        endpoint='/api/application-agent/handoff'
        def event(name,**extra):return self.call(endpoint,{**self.ids,'id':pause_id,'event':name,**extra})['handoff']
        started=self.clock();opened=False;ended=False;resume_capture=False
        if watch:watch.detach()
        try:
            h=event('begin',kind=kind,questions=[str(q)[:300] for q in questions[:10]],challengeHosts=sorted(self.pending))
            # Prevent a manual employer submit; provider checks remain usable.
            for frame in page.frames:
                if verification_family(frame.url):continue
                try:frame.evaluate("""()=>{window.__cyberapplyHumanPause=true;if(!window.__cyberapplyPauseGuard){window.__cyberapplyPauseGuard=true;document.addEventListener('submit',e=>{if(window.__cyberapplyHumanPause){e.preventDefault();e.stopImmediatePropagation();}},true);document.addEventListener('click',e=>{const b=e.target.closest('button,input[type=submit]');if(window.__cyberapplyHumanPause&&b&&/^(submit(?: application)?|send application|apply(?: now)?|complete application|next|continue|next step|review application)$/i.test((b.innerText||b.value||'').trim())){e.preventDefault();e.stopImmediatePropagation();}},true);}}""")
                except Exception:pass
            while self.clock()-started<240:
                if page.is_closed() or self.blocked_navigation:
                    event('failed',code='session_changed');ended=True;return False
                h=self.call(endpoint+'?'+urlencode(self.ids),None)['handoff']
                if not h or h['id']!=pause_id:return False
                if h['state'] in {'cancelled','expired','failed'}:ended=True;return False
                if h['state']=='opening':
                    if authorize() is not True:event('failed',code='session_changed');ended=True;return False
                    self.approved.update(h['approvedHosts']);self.pending.difference_update(self.approved)
                    try:self.window(context,page,'normal');self._reload_challenge_resources(page)
                    except Exception:event('failed',code='window_unavailable');ended=True;return False
                    h=event('opened');opened=True
                if h['state']=='resuming' and opened:
                    if authorize() is not True:event('failed',code='session_changed');ended=True;return False
                    if self.pending-self.approved:event('failed',code='session_changed');ended=True;return False
                    if page.locator('input[type="password"]:visible,input[autocomplete="one-time-code"]:visible').count() or not completed():event('opened',code='incomplete')
                    else:
                        confirmed=event('resumed')
                        ended=True;resume_capture=confirmed['state']=='resumed';return resume_capture
                page.wait_for_timeout(1000)
            event('expired');ended=True;return False
        finally:
            if not ended:
                try:event('failed',code='connection_lost')
                except Exception:pass
            self.active=False
            for frame in page.frames:
                if verification_family(frame.url):continue
                try:frame.evaluate('()=>{window.__cyberapplyHumanPause=false;}')
                except Exception:pass
            if opened:
                try:self.window(context,page,'minimized')
                except Exception:pass
            if resume_capture and watch and not page.is_closed():watch.attach(context,page)

def manual_value(field,control):
    """Observe human input only. Never choose an answer or inspect CAPTCHA tokens."""
    kind=field['type']
    if kind=='select':
        if not control.input_value():return None
        value=control.evaluate("e=>e.selectedOptions[0]?.disabled?'':e.selectedOptions[0]?.text||''")
        return ('select',value) if value and value in field.get('options',[]) else None
    if kind=='combobox':
        from .combobox import selected_display
        values=[option for option in field.get('options',[]) if selected_display(control,option)]
        return ('combobox',values[0]) if len(values)==1 else None
    if kind in {'checkbox','radio'}:
        value=control.is_checked()
        return ('checked',value) if value or kind=='radio' or not field.get('required') else None
    if kind in {'text','email','tel','textarea','url','number'}:
        value=control.input_value();return ('value',value) if value.strip() else None
    return None
