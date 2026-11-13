"""Owner-controlled, bounded handoff of the existing browser, never a solver."""
import re
import time
from urllib.parse import urlencode
from uuid import uuid4
from .employer_verification import recaptcha_resource

def identity_question(label):
    text=re.sub(r'\s+',' ',str(label).strip()).casefold()
    return bool(re.match(r'^which(?: of (?:the )?following)? best describes you\b',text))

def identity_dropdown(field):
    """Only the requested human-versus-AI select, never a general verification."""
    if field.get('type') not in {'select','combobox'} or not identity_question(field.get('label','')):return False
    choices=[re.sub(r'\s+',' ',str(x).strip()).casefold().strip(' .!*') for x in field.get('options',[])]
    human=any(re.fullmatch(r'(?:i am )?(?:a )?human(?: being)?',x) for x in choices)
    agent=any(re.fullmatch(r'(?:i am )?(?:an? )?(?:ai|artificial intelligence)(?:[ /-]*(?:llm|agent|bot|assistant|program))*',x) for x in choices)
    return human and agent

class BrowserHandoff:
    def __init__(self,call,task,clock=time.monotonic):
        self.call=call;self.ids={k:task[k] for k in ('requestId','claimId')};self.clock=clock
        self.active=False;self.turns=0
        self.kind='question';self.phase='before_submit';self.recaptcha=None
        self.blocked_navigation=False
    def window(self,context,page,state):
        session=context.new_cdp_session(page)
        try:
            info=session.send('Browser.getWindowForTarget')
            session.send('Browser.setWindowBounds',{'windowId':info['windowId'],'bounds':{'windowState':state}})
            if state=='normal':page.bring_to_front()
        finally:session.detach()
    def __call__(self,context,page,questions,authorize,completed,watch=None,kind='question',phase='before_submit'):
        if kind not in {'question','recaptcha'} or not questions or (kind=='question' and not all(identity_question(q) for q in questions)) or self.turns>=2:return False
        if kind=='recaptcha' and (not self.recaptcha or questions!=['Complete the employer reCAPTCHA in this browser.']):return False
        self.turns+=1;pause_id=str(uuid4());self.active=True;self.blocked_navigation=False
        self.kind=kind;self.phase=phase
        endpoint='/api/application-agent/handoff'
        def event(name,**extra):return self.call(endpoint,{**self.ids,'id':pause_id,'event':name,**extra})['handoff']
        started=self.clock();opened=False;ended=False;resume_capture=False
        if watch:watch.detach()
        try:
            h=event('begin',kind=kind,phase=phase,questions=[str(q)[:300] for q in questions[:10]],challengeHosts=sorted(self.recaptcha.pending) if kind=='recaptcha' else [])
            # Human control is limited to the existing employer dropdown.
            for frame in page.frames:
                if recaptcha_resource(frame.url):continue
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
                    try:
                        if kind=='recaptcha':
                            self.recaptcha.approved.update(h['approvedHosts']);self.recaptcha.pending.difference_update(self.recaptcha.approved)
                        self.window(context,page,'normal')
                        if kind=='recaptcha':self.recaptcha.restore(page)
                    except Exception:event('failed',code='window_unavailable');ended=True;return False
                    h=event('opened');opened=True
                if h['state']=='resuming' and opened:
                    if authorize() is not True:event('failed',code='session_changed');ended=True;return False
                    if kind=='recaptcha' and self.recaptcha.pending-self.recaptcha.approved:event('failed',code='session_changed');ended=True;return False
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
                if recaptcha_resource(frame.url):continue
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
    return None
