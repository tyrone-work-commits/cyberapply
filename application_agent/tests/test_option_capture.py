from application_agent.tests.test_browser import run
from application_agent.tests.test_combobox import dropdowns
from application_agent.reasoning import build_plan


def test_unknown_choices_are_saved_without_selecting_or_submitting():
    result,posts=run(dropdowns([{'label':'Preferred shift?','options':['Day','Night']}]),planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    question=next(q for q in result['report']['questions'] if q['question']=='Preferred shift?')
    assert question['options']==['Day','Night']
    assert not any(a['question']=='Preferred shift?' for a in result['report']['answers'])


def test_captured_human_options_remain_a_verification_pause():
    result,posts=run(dropdowns([{'label':'Which best describes you?','options':['I am an AI, bot, or automated program.','I am a human.']}]),planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    question=next(q for q in result['report']['questions'] if q['question']=='Which best describes you?')
    assert len(question['options'])==2
    assert not any(a['question']=='Which best describes you?' for a in result['report']['answers'])


def test_delayed_options_are_captured_after_listbox_mounts():
    script="""const input=document.getElementById('combo0'),menu=document.getElementById('menu0');
    input.addEventListener('click',()=>{const options=[...menu.children];menu.replaceChildren();menu.setAttribute('aria-busy','true');setTimeout(()=>{menu.replaceChildren(...options);menu.setAttribute('aria-busy','false');},250);});"""
    result,posts=run(dropdowns([{'label':'Preferred shift?','options':['Day','Night']}],script),planner=build_plan)
    assert not posts
    assert next(q for q in result['report']['questions'] if q['question']=='Preferred shift?')['options']==['Day','Night']


def test_country_location_and_menus_after_twentieth_are_captured_without_answers():
    defs=[{'label':label,'options':['First choice','Second choice']} for label in ['Country','Location (City)']+[f'Preference {i}?' for i in range(23)]]
    result,posts=run(dropdowns(defs),planner=build_plan)
    assert not posts
    questions={q['question']:q for q in result['report']['questions']}
    for item in defs:assert questions[item['label']]['options']==item['options']


def test_capture_reads_virtualized_linked_rows_without_committing_a_choice():
    script="""const menu=document.getElementById('menu0'),input=document.getElementById('combo0');
    menu.style.height='60px';menu.style.overflowY='scroll';
    input.addEventListener('click',()=>{menu.innerHTML='<div role="option">First</div><div style="height:300px"></div>';menu.addEventListener('scroll',()=>{if(!menu.querySelector('[data-last]')){const last=document.createElement('div');last.setAttribute('data-last','1');last.role='option';last.textContent='Last';menu.append(last);}});});"""
    result,posts=run(dropdowns([{'label':'Preferred shift?','options':['First','Last']}],script),planner=build_plan)
    assert not posts
    assert next(q for q in result['report']['questions'] if q['question']=='Preferred shift?')['options']==['First','Last']
