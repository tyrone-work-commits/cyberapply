"""React-select style fixtures: all employer requests are intercepted locally."""
import json

from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import FORM, PAYLOAD, run


def dropdowns(definitions, extra_script=''):
    """Each visible input has an aria-hidden required helper, as on the audited form."""
    content=''
    for i, definition in enumerate(definitions):
        label=definition['label']
        content+=f'''<div class="field" id="field{i}"><label for="combo{i}">{label}</label>
          <div class="control"><div class="value-container"><span class="chosen"></span><span class="placeholder">Select...</span>
          <input id="combo{i}" role="combobox" aria-controls="menu{i}" aria-expanded="false" aria-required="true" autocomplete="off"></div></div>
          <input class="helper" aria-hidden="true" tabindex="-1" required style="position:absolute;opacity:0;width:1px;height:1px">
          <input type="hidden" name="answer{i}"><div id="menu{i}" role="listbox" hidden style="min-height:20px"></div></div>'''
    script='''<script>const defs=DEFINITIONS;
    defs.forEach((def,i)=>{
      const root=document.getElementById('field'+i), input=root.querySelector('[role=combobox]'), menu=root.querySelector('[role=listbox]');
      function render(query=''){
        menu.replaceChildren();
        const choices=def.searchOnly&&!query?[]:def.options.filter(text=>!query||text.toLowerCase().includes(query.toLowerCase()));
        if(!choices.length){const msg=document.createElement('div');msg.textContent='No matching options';menu.append(msg);}
        for(const text of choices){const option=document.createElement('div');option.role='option';option.textContent=text;
          if((def.disabledOptions||[]).includes(text))option.setAttribute('aria-disabled','true');
          option.addEventListener('click',()=>{
            root.querySelector('.chosen').textContent=text;root.querySelector('.placeholder').hidden=true;
            root.querySelector('.helper').value=text;root.querySelector('[type=hidden]').value=text;
            input.value='';menu.hidden=true;input.setAttribute('aria-expanded','false');
            root.dispatchEvent(new Event('chosen',{bubbles:true}));
          });menu.append(option);
        }
      }
      input.addEventListener('click',()=>{render(input.value);menu.hidden=false;input.setAttribute('aria-expanded','true');});
      input.addEventListener('input',()=>setTimeout(()=>{render(input.value);menu.hidden=false;input.setAttribute('aria-expanded','true');},60));
      input.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.hidden=true;input.setAttribute('aria-expanded','false');}});
    });EXTRA_SCRIPT</script>'''.replace('DEFINITIONS',json.dumps(definitions)).replace('EXTRA_SCRIPT',extra_script)
    return FORM.replace('{extra}',content+script)


def test_labelled_dropdowns_ignore_helpers_and_select_profile_answers():
    definitions=[{'label':'Country*','options':['United Kingdom +44','United States +1']},
      {'label':'Location (City)*','options':['Dallas, Texas, United States','Dallas, Scotland, United Kingdom'],'searchOnly':True},
      {'label':'Are you authorized to work in the United Kingdom or Ireland for any employer?*','options':['Yes','No']},
      {'label':'Are you located in the United Kingdom or Ireland?*','options':['Yes','No']}]
    profile={'country':'USA','city':'Dallas','location':'Dallas, USA','ukRightToWork':False,'irelandRightToWork':None}
    result,posts=run(dropdowns(definitions),payload={**PAYLOAD,'applicantProfile':profile},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1, result
    selected=[a for a in result['report']['answers'] if 'selected_option' in a]
    assert [a['selected_option'] for a in selected]==['United States +1','Dallas, Texas, United States','No','No']
    assert not result['report']['unresolved']
    assert all(a['question']!='Unlabelled field' for a in result['report']['answers'])
    assert b'United States +1' in posts[0] and b'Dallas, Texas, United States' in posts[0]


def test_duplicate_and_nonmatching_options_do_not_select_first_suggestion():
    for options in [['No','No'],['Not authorized','Maybe']]:
        result,posts=run(dropdowns([{'label':'Are you authorized to work in UK or Ireland?','options':options}]),payload={**PAYLOAD,'applicantProfile':{}},planner=build_plan)
        assert result['status']=='needs_attention' and not posts, result
        assert any('unique offered option' in item['reason'] for item in result['report']['unresolved'])


def test_unknown_city_and_ambiguous_same_country_city_pause():
    for options in [['Paris, France'],['Dallas, Texas, United States','Dallas, Oregon, United States']]:
        result,posts=run(dropdowns([{'label':'Location (City)','options':options,'searchOnly':True}]),payload={**PAYLOAD,'applicantProfile':{'city':'Dallas','country':'USA'}},planner=build_plan)
        assert result['status']=='needs_attention' and not posts, result


def test_dropdown_requires_its_own_linked_option_list():
    html=dropdowns([{'label':'Country','options':['Nigeria']}]).replace('aria-controls="menu0"','')
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts, result
    assert any('option list' in item['reason'] for item in result['report']['unresolved'])


def test_custom_consent_needs_exact_question_confirmation():
    question='I agree to processing of my application'
    html=dropdowns([{'label':question,'options':['Yes','No']}])
    pending,posts=run(html,planner=build_plan)
    assert pending['status']=='needs_attention' and not posts
    approved,posts=run(html,payload={**PAYLOAD,'confirmedAnswers':[{'question':question,'value':'Yes'}]},planner=build_plan)
    assert approved['status']=='applied' and len(posts)==1, approved


def test_dropdown_selection_is_verified_again_before_submission():
    html=dropdowns([{'label':'Country','options':['Nigeria']}],"document.getElementById('field0').addEventListener('chosen',()=>setTimeout(()=>document.querySelector('.chosen').textContent='Changed by employer script',60));")
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts, result
    assert 'changed after preparation' in result['message'] or any('confirm' in q['reason'] for q in result['report']['unresolved'])


def test_dropdown_revealing_a_new_required_question_is_reinspected():
    html=dropdowns([{'label':'Country','options':['Nigeria']}],"document.getElementById('field0').addEventListener('chosen',()=>{if(!document.getElementById('new-question')){const q=document.createElement('input');q.id='new-question';q.required=true;q.setAttribute('aria-label','Work authorization');document.querySelector('form').append(q);}});")
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts, result
    assert any(q['question']=='Work authorization' for q in result['report']['unresolved'])


def test_real_unlabelled_required_input_is_not_silently_ignored():
    result,posts=run(FORM.replace('{extra}','<input required>'),planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    assert any(q['question']=='Unlabelled field' for q in result['report']['unresolved'])


def test_generic_attach_label_uses_explicit_resume_id_and_exact_cv():
    html=FORM.replace('Resume<input type="file" name="resume" required>','Attach<input type="file" id="resume" name="resume" required>')
    result,posts=run(html,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1, result
    assert b'Private selected CV bytes' in posts[0]


def test_dropdown_dry_run_fills_without_submitting():
    result,posts=run(dropdowns([{'label':'Country','options':['Nigeria']}]),payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan,submit=False)
    assert result['status']=='needs_attention' and not posts, result
    assert result['report']['answers'][-1]['selected_option']=='Nigeria'
    assert 'Dry run' in result['message']


def test_disabled_offered_option_cannot_be_selected():
    result,posts=run(dropdowns([{'label':'Country','options':['Nigeria','Ghana'],'disabledOptions':['Nigeria']}]),payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts, result


def test_cv_supported_experience_can_select_yes_but_not_invent_experience():
    html=dropdowns([{'label':'Do you have experience with Splunk?','options':['Yes','No']}])
    result,posts=run(html,payload={**PAYLOAD,'cv':{**PAYLOAD['cv'],'text':'Alex alex@example.com\nInvestigated Splunk alerts.'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1, result
    unknown,posts=run(html,planner=build_plan)
    assert unknown['status']=='needs_attention' and not posts


def test_aria_hidden_ancestor_helper_is_not_reported_as_a_question():
    html=dropdowns([{'label':'Country','options':['Nigeria']}]).replace('</form>','<div aria-hidden="true"><input aria-required="true" tabindex="-1"></div></form>')
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1, result


def test_button_combobox_selects_only_its_linked_option():
    extra='''<button type="button" role="combobox" id="country" aria-label="Country" aria-controls="countries" aria-expanded="false" aria-required="true">Select...</button>
      <div role="listbox" id="countries" hidden><div role="option">Nigeria</div></div><input type="hidden" name="country">
      <script>const combo=document.getElementById('country'),list=document.getElementById('countries');combo.onclick=()=>{list.hidden=false;combo.setAttribute('aria-expanded','true');};
      list.firstElementChild.onclick=()=>{combo.textContent='Nigeria';combo.setAttribute('aria-expanded','false');list.hidden=true;document.querySelector('[name=country]').value='Nigeria';};</script>'''
    result,posts=run(FORM.replace('{extra}',extra),payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1, result
