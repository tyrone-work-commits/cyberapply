"""Regression fixtures for the audited travel menu; no employer network calls."""
import json
import pytest
from application_agent.tests.test_combobox import dropdowns
from application_agent.tests.test_browser import run,FORM,PAYLOAD
from application_agent.reasoning import build_plan
from application_agent.multiselect import parse_multiple

QUESTION='Are you open to travel if required?*'
CHOICES=['No Travel','0-25%','25-50%','50%+']

def multi_html(initial=(),required=True,choices=CHOICES):
    script='''const input=document.getElementById('combo0'),root=document.getElementById('field0'),menu=document.getElementById('menu0');
    menu.id='react-select-question_123[]-listbox';input.setAttribute('aria-controls',menu.id);menu.setAttribute('aria-multiselectable','true');
    let selected=INITIAL;
    function renderSelected(){root.querySelectorAll('.select__multi-value__label,[data-remove]').forEach(e=>e.remove());for(const label of selected){const chip=document.createElement('span');chip.className='select__multi-value__label';chip.textContent=label;root.querySelector('.value-container').append(chip);const remove=document.createElement('button');remove.type='button';remove.dataset.remove='1';remove.setAttribute('aria-label','Remove '+label);remove.textContent='×';remove.onclick=()=>{selected=selected.filter(v=>v!==label);renderSelected();};root.querySelector('.value-container').append(remove);}root.querySelector('.helper').value=selected.length?JSON.stringify(selected):'';root.querySelector('[type=hidden]').value=JSON.stringify(selected);}
    input.addEventListener('click',()=>{for(const option of menu.querySelectorAll('[role=option]')){option.setAttribute('aria-selected',selected.includes(option.textContent)?'true':'false');option.hidden=selected.includes(option.textContent);}});
    menu.addEventListener('click',e=>{const option=e.target.closest('[role=option]');if(!option)return;e.stopImmediatePropagation();e.preventDefault();selected=selected.includes(option.textContent)?selected.filter(x=>x!==option.textContent):[...selected,option.textContent];renderSelected();input.value='';menu.hidden=true;input.setAttribute('aria-expanded','false');},true);
    renderSelected();OPTIONAL'''.replace('INITIAL',json.dumps(list(initial))).replace('OPTIONAL',"input.setAttribute('aria-required','false');root.querySelector('.helper').required=false;" if not required else '')
    return dropdowns([{'label':QUESTION,'options':choices}],script)

@pytest.mark.parametrize('value,expected',[('["25-50%","0-25%"]',['0-25%','25-50%']),('No Travel',['No Travel']),('[]',[]),('["Missing"]',None),('["0-25%","0-25%"]',None),('[1]',None)])
def test_exact_multiple_answer_validation(value,expected):assert parse_multiple(value,CHOICES)==expected

def test_realistic_bracketed_id_multi_menu_is_captured_without_guessing_or_submitting():
    result,posts=run(multi_html(),planner=build_plan)
    assert not posts and result['status']=='needs_attention'
    q=next(q for q in result['report']['questions'] if q['question']==QUESTION)
    assert q['multiple'] is True and q['options']==CHOICES
    assert not any(a.get('question')==QUESTION for a in result['report']['answers'])

def test_exact_user_selections_fill_and_verify_all_chips_then_submit_fixture_once():
    payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["0-25%","25-50%"]'}]}
    result,posts=run(multi_html(),planner=build_plan,payload=payload)
    assert result['status']=='applied' and len(posts)==1,result
    assert any(a.get('question')==QUESTION and json.loads(a['value'])==['0-25%','25-50%'] for a in result['report']['answers'])
    assert b'0-25%' in posts[0] and b'25-50%' in posts[0]

def test_optional_existing_choices_can_be_explicitly_cleared_without_toggling_or_guessing():
    payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'[]'}]}
    result,posts=run(multi_html(['No Travel'],required=False),planner=build_plan,payload=payload)
    assert result['status']=='applied' and len(posts)==1,result
    assert b'name="answer0"\r\n\r\n[]' in posts[0]

def test_invalid_multi_choice_remains_unsent():
    result,posts=run(multi_html(),planner=build_plan,payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["Unlisted"]'}]})
    assert result['status']=='needs_attention' and not posts


def test_native_multi_select_retains_only_the_explicit_offered_choices():
    html=FORM.replace('{extra}','<label>'+QUESTION+'<select name="travel" multiple required>'+''.join('<option>'+x+'</option>' for x in CHOICES)+'</select></label>')
    result,posts=run(html,planner=build_plan,payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["0-25%","25-50%"]'}]})
    assert result['status']=='applied' and len(posts)==1,result
    assert b'No Travel' not in posts[0] and b'0-25%' in posts[0] and b'25-50%' in posts[0]


def test_saved_multi_choice_library_answer_is_reused_against_the_exact_offered_choices():
    payload={**PAYLOAD,'applicantProfile':{'employerQuestions':[{'question':QUESTION,'fieldType':'combobox','multiple':True,'answer':'["0-25%"]','source':'user','reusePolicy':'exact_question','updatedAt':'2026-11-16'}]}}
    result,posts=run(multi_html(),planner=build_plan,payload=payload)
    assert result['status']=='applied' and len(posts)==1,result
    assert any(a.get('question')==QUESTION and a['source']=='saved_profile' for a in result['report']['answers'])


def test_selected_hidden_choice_stays_in_catalog_after_reopening_the_same_form():
    payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["25-50%"]'}]}
    result,posts=run(multi_html(['25-50%']),planner=build_plan,payload=payload)
    q=next(q for q in result['report']['questions'] if q['question']==QUESTION)
    assert set(q['options'])==set(CHOICES),q
    assert result['status']=='applied' and len(posts)==1,result


def test_reinspection_after_a_dependent_field_appears_keeps_the_selected_choice():
    html=multi_html()+"""<script>new MutationObserver(()=>{if(document.querySelector('.select__multi-value__label')&&!document.getElementById('additional-note')){const label=document.createElement('label');label.textContent='Additional note';const input=document.createElement('input');input.id='additional-note';input.name='note';label.append(input);document.querySelector('form').append(label);}}).observe(document.getElementById('field0'),{childList:true,subtree:true});</script>"""
    result,posts=run(html,planner=build_plan,payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["25-50%"]'}]})
    assert any(q['question']=='Additional note' for q in result['report']['questions']),result
    q=next(q for q in result['report']['questions'] if q['question']==QUESTION)
    assert set(q['options'])==set(CHOICES),q
    assert result['status']=='applied' and len(posts)==1,result


def test_all_selected_choices_survive_an_empty_remaining_options_menu():
    result,posts=run(multi_html(CHOICES),planner=build_plan,payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':json.dumps(CHOICES)}]})
    q=next(q for q in result['report']['questions'] if q['question']==QUESTION)
    assert set(q['options'])==set(CHOICES),q
    assert result['status']=='applied' and len(posts)==1,result


def test_selected_choice_is_retained_even_when_the_catalog_is_truncated():
    choices=[f'Choice {i}' for i in range(150)]
    result,posts=run(multi_html(['Choice 149'],choices=choices),planner=build_plan,payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["Choice 149"]'}]})
    q=next(q for q in result['report']['questions'] if q['question']==QUESTION)
    assert len(q['options'])==100 and q['optionsTruncated'] and 'Choice 149' in q['options'],q
    assert result['status']=='applied' and len(posts)==1,result


def test_another_fields_chip_and_a_saved_answer_cannot_invent_an_offered_choice():
    neighbor='<div><label for="other-choice">Other preference</label><input id="other-choice" role="combobox" aria-controls="other-list"><span class="select__multi-value__label">Foreign option</span><div id="other-list" role="listbox" hidden></div></div>'
    html=multi_html().replace('</form>',neighbor+'</form>')
    result,posts=run(html,planner=build_plan,payload={**PAYLOAD,'confirmedAnswers':[{'question':QUESTION,'value':'["Foreign option"]'}]},submit=False)
    q=next(q for q in result['report']['questions'] if q['question']==QUESTION)
    assert q['options']==CHOICES and 'Foreign option' not in q['options']
    assert not posts and result['status']=='needs_attention'
