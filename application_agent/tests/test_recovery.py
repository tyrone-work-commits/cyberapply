import json
import pytest

from application_agent.recovery import FormRecovery, RecoveryStopped, TransientFormError
from application_agent.tests.test_browser import CV, PAYLOAD, FORM, browser_factory, dns, plan, run
from application_agent.tests.test_combobox import dropdowns
from application_agent.browser import execute_application
from application_agent.reasoning import build_plan


def test_transient_failure_recovers_with_bounded_data_free_evidence():
    report={};calls=[];waits=[];auth=[]
    recovery=FormRecovery(report,lambda:auth.append(True) or True,waits.append)
    def operation():
        calls.append(True)
        if len(calls)<3:raise TransientFormError('private applicant value must not be logged')
        return 'done'
    assert recovery.run('fill_saved_answer',operation,'0:cyberapply-1')=='done'
    assert len(calls)==3 and len(auth)==2 and waits==[200,400]
    assert report['recovery']['events']==[{'action':'fill_saved_answer','attempts':3,'outcome':'recovered','field_id':'0:cyberapply-1'}]
    assert 'private' not in json.dumps(report)


def test_no_replay_after_authorization_changes_or_possible_delivery():
    calls=[];report={}
    def operation():calls.append(True);raise TransientFormError()
    with pytest.raises(RecoveryStopped,match='authorization changed or data may already'):
        FormRecovery(report,lambda:False,lambda _:None).run('fill_saved_answer',operation)
    assert len(calls)==1 and report['recovery']['retries']==0


def test_per_operation_and_global_limits():
    report={};calls=[];repair=FormRecovery(report,lambda:True,lambda _:None)
    def fail():calls.append(True);raise TransientFormError()
    for _ in range(8):
        with pytest.raises(RecoveryStopped):repair.run('read_form',fail)
    assert repair.retries==8 and len(calls)==16


def test_elapsed_budget_includes_authorization_check():
    now=[0];calls=[]
    def authorize():now[0]=31;return True
    def fail():calls.append(True);raise TransientFormError()
    with pytest.raises(RecoveryStopped,match='time limit'):
        FormRecovery({},authorize,lambda _:None,clock=lambda:now[0]).run('read_form',fail)
    assert len(calls)==1


def test_semantic_errors_and_final_actions_are_never_retried():
    repair=FormRecovery({},lambda:True,lambda _:None);calls=[]
    def fail():calls.append(True);raise ValueError('Missing actual personal fact')
    with pytest.raises(ValueError):repair.run('fill_saved_answer',fail)
    with pytest.raises(ValueError,match='cannot be automatically replayed'):repair.run('submit_application',fail)
    assert len(calls)==1 and repair.retries==0


def test_initial_temporary_employer_error_recovers_then_submits_once():
    gets=[]
    def employer(req):
        if req.method=='POST':return 'Your application has been submitted'
        gets.append(req.url)
        return {'body':'Temporarily unavailable','status':503} if len(gets)==1 else FORM.replace('{extra}','')
    result,posts=run(employer)
    assert result['status']=='applied' and len(posts)==1,result
    assert gets.count(PAYLOAD['job']['applyUrl'])==2
    assert result['report']['recovery']['events'][0]['action']=='open_employer_page'
    assert 'Automatically recovered' in result['message']


def resetting_form(script=''):
    return FORM.replace('{extra}',"""<script>const email=document.querySelector('[name=email]');let resets=0;
    email.addEventListener('input',()=>{if(!resets++){email.value='';EXTRA}});</script>""".replace('EXTRA',script))


def test_rejected_temporary_text_fill_is_repaired_from_same_cv():
    result,posts=run(resetting_form())
    assert result['status']=='applied' and len(posts)==1 and CV in posts[0],result
    assert b'alex@example.com' in posts[0]
    assert result['report']['recovery']['events']==[{'action':'fill_saved_answer','attempts':2,'outcome':'recovered','field_id':'0:cyberapply-0'}]


def test_changed_question_during_wait_never_receives_the_previous_answer():
    html=resetting_form("setTimeout(()=>email.setAttribute('aria-label','Different confidential question'),20);")
    result,posts=run(html)
    assert result['status']=='needs_attention' and not posts,result
    assert 'old answer was not replayed' in result['message']


def test_recovery_rechecks_revoked_authorization_before_refilling():
    posts=[]
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
        playwright_factory=lambda:browser_factory(resetting_form(),posts),timeout=1000,before_submit=lambda:False)
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['recovery']['retries']==0


def test_possible_autosave_stops_repairs_and_never_clicks_submit():
    html=resetting_form("fetch('/autosave',{method:'POST',body:'partial'}).catch(()=>{});")
    result,posts=run(html)
    assert result['status']=='uncertain' and len(posts)==1,result
    assert posts[0]==b'partial' and result['report']['recovery']['retries']==0


def test_autosave_arriving_during_repair_wait_also_prevents_replay():
    html=resetting_form("setTimeout(()=>fetch('/autosave',{method:'POST',body:'delayed-partial'}).catch(()=>{}),20);")
    result,posts=run(html)
    assert result['status']=='uncertain' and len(posts)==1,result
    assert posts[0]==b'delayed-partial' and result['report']['recovery']['retries']==0


def test_search_only_dropdown_is_repaired_before_requesting_a_human():
    html=dropdowns([{'label':'Location (City)','options':['Dallas, Texas, United States'],'searchOnly':True}],
        "const input=document.getElementById('combo0');input.removeAttribute('aria-controls');input.addEventListener('input',()=>input.setAttribute('aria-controls','menu0'));")
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'city':'Dallas','country':'USA'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
    assert any(a.get('selected_option')=='Dallas, Texas, United States' for a in result['report']['answers'])


def test_failed_menu_open_retries_then_confirms_exact_offered_option():
    html=dropdowns([{'label':'Country','options':['Nigeria']}],"""const input=document.getElementById('combo0');input.readOnly=true;let opens=0;
      input.addEventListener('click',()=>{if(!opens++){input.removeAttribute('aria-controls');document.getElementById('menu0').hidden=true;}else input.setAttribute('aria-controls','menu0');});""")
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
    assert any(e['action']=='select_labelled_dropdown' and e['outcome']=='recovered' for e in result['report']['recovery']['events'])


def test_revoked_dropdown_repair_stops_before_filling_later_fields():
    html=dropdowns([{'label':'Country','options':['Nigeria']}],"""const input=document.getElementById('combo0');input.readOnly=true;
      input.addEventListener('click',()=>{input.removeAttribute('aria-controls');document.getElementById('menu0').hidden=true;});
      const later=document.createElement('input');later.required=true;later.setAttribute('aria-label','Phone');later.oninput=()=>fetch('/later-write',{method:'POST',body:'must-not-run'});document.querySelector('form').append(later);""")
    posts=[]
    result=execute_application({**PAYLOAD,'applicantProfile':{'country':'Nigeria','phone':'+2348012345678'}},CV,submit=True,planner=build_plan,research_fn=lambda _:{},resolver=dns,
        playwright_factory=lambda:browser_factory(html,posts),timeout=1000,before_submit=lambda:False)
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['unresolved'][0]['source']=='agent_recovery'


def test_unsupported_answers_do_not_trigger_guessing_or_a_retry_loop():
    result,posts=run(FORM.replace('{extra}','<label>Secret required qualification<input required></label>'),planner=build_plan)
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['recovery']['retries']==0 and result['report']['unresolved']


def test_technical_dropdown_failure_is_not_reported_as_missing_profile_data():
    html=dropdowns([{'label':'Country','options':['Ghana']}])
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts,result
    assert 'Automatic form repairs' in result['message']
    assert result['report']['unresolved'][0]['source']=='agent_recovery'
    assert result['report']['recovery']['retries']==0  # A different country is not a repair.


def test_embedded_form_is_not_misdiagnosed_as_a_loading_main_page():
    def employer(req):
        if req.url.endswith('/inner'):return FORM.replace('{extra}','')
        if req.method=='POST':return 'Your application has been submitted'
        return '<iframe src="/inner"></iframe>'
    result,posts=run(employer)
    assert result['status']=='applied' and len(posts)==1,result


def test_no_receipt_never_replays_final_submission():
    result,posts=run(FORM.replace('{extra}',''),success=False)
    assert result['status']=='uncertain' and len(posts)==1 and result['report']['recovery']['retries']==0,result


def test_dry_run_repairs_ui_without_sending_any_application():
    result,posts=run(resetting_form(),submit=False)
    assert result['status']=='needs_attention' and 'Dry run' in result['message'] and not posts,result
    assert result['report']['recovery']['retries']==1
