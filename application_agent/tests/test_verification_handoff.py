"""Synthetic local forms only. No real employer or CAPTCHA is contacted/solved."""
from contextlib import contextmanager
import pytest
from application_agent.browser import execute_application
from application_agent.verification_handoff import BrowserHandoff,verification_family
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan,browser_factory

@contextmanager
def hidden_factory(html,posts,success=True):
    with browser_factory(html,posts,success) as runtime:
        original=runtime.chromium.launch
        runtime.chromium.launch=lambda **kw:original(**{**kw,'headless':True})
        yield runtime

class FixtureHandoff(BrowserHandoff):
    def __init__(self,mutate=True,cancel=False,tamper=False,attempt_submit=False,replace_cv=False):
        self.page=None;self.context=None;self.windows=[];self.events=[];self.current=None;self.mutate=mutate;self.cancel=cancel
        super().__init__(self.api,{'requestId':'one','claimId':'fixture-claim'})
        self.tamper=tamper;self.attempt_submit=attempt_submit
        self.replace_cv=replace_cv
    def window(self,context,page,state):
        if self.context is not None:assert context is self.context and page is self.page
        self.context,self.page=context,page;self.windows.append(state)
    def api(self,path,body):
        if body:
            self.events.append(body['event']);self.current={**(self.current or {}),**body,'state':'waiting' if body['event']=='begin' else body['event'],'approvedHosts':[]}
            if body['event']=='opened' and self.mutate:
                # Simulated human actor on this isolated fixture; production never selects it.
                assert self.page.locator('input[type=file]').evaluate('e=>e.files[0].name')=='chosen.pdf'
                self.page.get_by_label('Fixture manual verification').select_option(label='Manually completed')
                if self.tamper:self.page.get_by_label('Email').fill('changed@example.test')
                if self.attempt_submit:self.page.get_by_role('button',name='Submit application').click()
                if self.replace_cv:self.page.locator('input[type=file]').set_input_files({'name':'chosen.pdf','mimeType':'application/pdf','buffer':b'X'*len(CV)})
        else:
            self.current['state']='cancelled' if self.cancel else 'opening' if self.current['state']=='waiting' else 'resuming'
        return {'handoff':self.current}

def manual_plan(payload,fields,research):
    result=plan(payload,fields,research)
    result['unresolved']=[{'field_id':f['id'],'question':f['label'],'source':'verification'} for f in fields if f['label']=='Fixture manual verification']
    return result

def run_fixture(handoff,success=True):
    html=FORM.replace('{extra}','<label>Fixture manual verification<select name="manual" required><option value="">Choose</option><option value="done">Manually completed</option></select></label>')
    posts=[]
    result=execute_application(PAYLOAD,CV,submit=True,planner=manual_plan,research_fn=lambda _: {},resolver=dns,timeout=500,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts,success),verification_handler=handoff)
    return result,posts

def test_exact_page_context_and_cv_survive_manual_handoff_then_one_submit_confirms():
    handoff=FixtureHandoff();result,posts=run_fixture(handoff)
    assert result['status']=='applied',result
    assert len(posts)==1 and CV in posts[0] and b'Manually completed' not in posts[0] and b'done' in posts[0]
    assert handoff.events==['begin','opened','resumed']
    assert handoff.windows==['minimized','normal','minimized']
    assert result['report']['journey']['submit_click_attempts']==1
    assert result['report']['verification_handoffs'][0]['same_browser'] is True
    assert not any(a.get('question')=='Fixture manual verification' for a in result['report']['answers'])

def test_cancelled_handoff_never_submits_or_launches_another_window():
    h=FixtureHandoff(cancel=True);result,posts=run_fixture(h)
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['journey']['submit_click_attempts']==0
    assert h.windows==['minimized']

def test_missing_manual_selection_does_not_resume_or_submit(monkeypatch):
    h=FixtureHandoff(mutate=False)
    ticks=iter([0,0,0,1,2,241,242]);h.clock=lambda:next(ticks,243)
    result,posts=run_fixture(h)
    assert result['status']=='needs_attention' and not posts,result
    assert 'resumed' not in h.events

def test_no_receipt_stays_uncertain_after_exactly_one_submission():
    h=FixtureHandoff();result,posts=run_fixture(h,success=False)
    assert result['status']=='uncertain' and len(posts)==1,result
    assert result['report']['journey']['submit_click_attempts']==1
    assert h.events.count('begin')==1

def test_other_field_changes_during_handoff_stop_instead_of_overwriting_or_submitting():
    result,posts=run_fixture(FixtureHandoff(tamper=True))
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['journey']['submit_click_attempts']==0

def test_accidental_manual_submit_is_blocked_then_agent_submits_only_once():
    result,posts=run_fixture(FixtureHandoff(attempt_submit=True))
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['submit_click_attempts']==1

def test_same_name_and_size_cannot_hide_a_changed_cv_during_manual_control():
    result,posts=run_fixture(FixtureHandoff(replace_cv=True))
    assert result['status']=='needs_attention' and not posts,result
    assert 'attachment bytes changed' in result['message']

def test_known_challenge_paths_have_exact_hosts_not_wildcards_or_private_urls():
    assert verification_family('https://www.google.com/recaptcha/api2/anchor?private=not-logged')
    for url in ['https://www.google.com.evil.test/recaptcha/api2/anchor','https://www.google.com/drive/','http://www.google.com/recaptcha/api2/anchor','https://user:pass@www.google.com/recaptcha/api2/anchor','https://127.0.0.1/recaptcha/api2/anchor']:
        assert not verification_family(url)

def test_custom_dropdown_keeps_the_humans_committed_selection_without_agent_selection():
    from application_agent.tests.test_combobox import dropdowns
    class CustomHandoff(FixtureHandoff):
        def __init__(self):super().__init__(mutate=False)
        def api(self,path,body):
            result=super().api(path,body)
            if body and body['event']=='opened':
                self.page.get_by_role('combobox').click()
                self.page.get_by_role('option',name='Manually completed',exact=True).click()
            return result
    h=CustomHandoff();posts=[];html=dropdowns([{'label':'Fixture manual verification','options':['Manually completed','Not completed']}])
    result=execute_application(PAYLOAD,CV,submit=True,planner=manual_plan,research_fn=lambda _: {},resolver=dns,timeout=1000,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['submit_click_attempts']==1

def test_blocked_provider_iframe_reloads_only_its_original_child_frame_after_approval():
    from types import SimpleNamespace
    url='https://www.google.com/recaptcha/api2/anchor?fixture=only'
    visits=[]
    frame=SimpleNamespace(url='chrome-error://chromewebdata/',goto=lambda target,**kw:visits.append(target))
    element=SimpleNamespace(evaluate=lambda _:url,content_frame=lambda:frame)
    page=SimpleNamespace(frames=[frame],locator=lambda _:SimpleNamespace(all=lambda:[element]))
    h=FixtureHandoff();h.resources={url:'document'};h.approved={'www.google.com'}
    h._reload_challenge_resources(page)
    assert visits==[url] and not h.resources

def test_challenge_access_needs_explicit_host_approval_and_provider_posts_cannot_carry_employer_writes():
    from types import SimpleNamespace
    h=FixtureHandoff();h.pins={'www.google.com','www.recaptcha.net','www.gstatic.com'}
    req=SimpleNamespace(url='https://www.google.com/recaptcha/api2/reload',method='POST',resource_type='xhr',frame=SimpleNamespace(url='https://employer.example/apply'))
    assert h.challenge_request(req) is False
    h.approved=set(h.pins)
    assert h.challenge_request(req) is False
    req.frame.url='https://www.google.com/recaptcha/api2/anchor'
    assert h.challenge_request(req) is True
