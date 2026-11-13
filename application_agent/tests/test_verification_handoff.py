"""Synthetic local forms only. No real employer or CAPTCHA is contacted/solved."""
from contextlib import contextmanager
import pytest
from application_agent.browser import execute_application
from application_agent.verification_handoff import BrowserHandoff,identity_dropdown
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
                self.page.get_by_label('Which of the following best describes you?').select_option(label='I am a human')
                if self.tamper:self.page.get_by_label('Email').fill('changed@example.test')
                if self.attempt_submit:self.page.get_by_role('button',name='Submit application').click()
                if self.replace_cv:self.page.locator('input[type=file]').set_input_files({'name':'chosen.pdf','mimeType':'application/pdf','buffer':b'X'*len(CV)})
        else:
            self.current['state']='cancelled' if self.cancel else 'opening' if self.current['state']=='waiting' else 'resuming'
        return {'handoff':self.current}

def manual_plan(payload,fields,research):
    result=plan(payload,fields,research)
    result['unresolved']=[{'field_id':f['id'],'question':f['label'],'source':'verification'} for f in fields if f['label']=='Which of the following best describes you?']
    return result

def run_fixture(handoff,success=True,planner=manual_plan):
    html=FORM.replace('{extra}','<label>Which of the following best describes you?<select name="manual" required><option value="">Choose</option><option value="done">I am a human</option><option value="agent">I am an AI agent</option></select></label>')
    posts=[]
    result=execute_application(PAYLOAD,CV,submit=True,planner=planner,research_fn=lambda _: {},resolver=dns,timeout=500,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts,success),verification_handler=handoff)
    return result,posts

def test_exact_page_context_and_cv_survive_manual_handoff_then_one_submit_confirms():
    handoff=FixtureHandoff();result,posts=run_fixture(handoff)
    assert result['status']=='applied',result
    assert len(posts)==1 and CV in posts[0] and b'I am a human' not in posts[0] and b'done' in posts[0]
    assert handoff.events==['begin','opened','resumed']
    assert handoff.windows==['minimized','normal','minimized']
    assert result['report']['journey']['submit_click_attempts']==1
    assert result['report']['verification_handoffs'][0]['same_browser'] is True
    assert not any(a.get('question')=='Which of the following best describes you?' for a in result['report']['answers'])

def test_production_planner_leaves_identity_dropdown_for_the_person_then_resumes_once():
    from application_agent.reasoning import build_plan
    h=FixtureHandoff();result,posts=run_fixture(h,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
    assert h.events==['begin','opened','resumed']
    assert result['report']['journey']['submit_click_attempts']==1

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

def test_custom_dropdown_keeps_the_humans_committed_selection_without_agent_selection():
    from application_agent.tests.test_combobox import dropdowns
    class CustomHandoff(FixtureHandoff):
        def __init__(self):super().__init__(mutate=False)
        def api(self,path,body):
            result=super().api(path,body)
            if body and body['event']=='opened':
                self.page.get_by_role('combobox').click()
                self.page.get_by_role('option',name='I am a human',exact=True).click()
            return result
    h=CustomHandoff();posts=[];html=dropdowns([{'label':'Which of the following best describes you?','options':['I am a human','I am an AI agent']}])
    result=execute_application(PAYLOAD,CV,submit=True,planner=manual_plan,research_fn=lambda _: {},resolver=dns,timeout=1000,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['submit_click_attempts']==1

def test_only_the_requested_dropdown_with_both_identity_options_is_eligible():
    question='Which of the following best describes you?'
    options=['Please select','I am a human','I am an AI agent']
    for kind in ['select','combobox']:
        assert identity_dropdown({'label':question,'type':kind,'options':options})
    for field in [
        {'label':'Are you a human?','type':'select','options':options},
        {'label':question,'type':'radio','options':options},
        {'label':question,'type':'text','options':options},
        {'label':question,'type':'select','options':['I am a human']},
        {'label':question,'type':'select','options':['Human Resources','AI Engineer']},
        {'label':'Salary expectations','type':'select','options':options},
    ]:assert not identity_dropdown(field)

@pytest.mark.parametrize('extra',[
    '<label>Are you a human?<select name="manual" required><option value="">Choose</option><option>Yes</option><option>No</option></select></label>',
    '<label>Which of the following best describes you?<input name="manual" required></label>',
    '<label>Which of the following best describes you?<select name="manual" required><option value="">Choose</option><option>I am a human</option></select></label>',
    '<div data-sitekey="isolated-fixture-only">Unrelated verification challenge</div>',
])
def test_other_verifications_do_not_open_a_handoff_or_submit(extra):
    h=FixtureHandoff();posts=[]
    def verification_plan(payload,fields,research):
        result=plan(payload,fields,research)
        result['unresolved']=[{'field_id':f['id'],'question':f['label'],'source':'verification'} for f in fields if f['label'] not in {'Email','Resume'}]
        return result
    result=execute_application(PAYLOAD,CV,submit=True,planner=verification_plan,research_fn=lambda _: {},resolver=dns,timeout=500,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(FORM.replace('{extra}',extra),posts),verification_handler=h)
    assert result['status']=='needs_attention' and not posts,result
    assert not h.events and 'normal' not in h.windows
    assert result['report']['journey']['submit_click_attempts']==0
