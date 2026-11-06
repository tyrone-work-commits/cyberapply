import pytest

from application_agent.phone import equivalent_phone
from application_agent.profile_answers import saved_profile_answer
from application_agent.tests.test_browser import PAYLOAD,run
from application_agent.tests.test_compact_country import compact_country
from application_agent.reasoning import build_plan


@pytest.mark.parametrize('expected,actual,code,match',[
    ('+2348000000000','+234 800 000 0000','',True),
    ('+2348000000000','800 000 0000','+234',True),
    ('+2348000000000','0800 000 0000','+234',True),
    ('+2348000000000','2348000000000','+234',True),
    ('+2348000000000','8000000001','+234',False),
    ('+2348000000000','8000000000','+1',False),
    ('+2348000000000','8000000000','',False),
    ('+2348000000000','8000000000 ext 123','+234',False),
    ('+390212345678','0212345678','+39',True),
    ('+390212345678','212345678','+39',False),
    ('8000000000','8000000000','+234',False),
])
def test_formatting_never_changes_the_saved_phone(expected,actual,code,match):
    assert equivalent_phone(expected,actual,code)==match


def phone_group():
    html=compact_country().replace("['United States +1','Canada +1']","['United States +1','Canada +1','Nigeria +234']")
    html=html.replace("textContent='+ 1'","textContent=name.match(/\\+\\d+$/)[0]")
    html=html.replace('<label for="country">','<fieldset class="phone-input"><legend>Phone</legend><label for="country">')
    html=html.replace('<div><div><span id="selected-code">','<div><div class="select__value-container"><span id="selected-code">')
    html=html.replace('</script>','''</script><label>Phone<input type="tel" id="phone" name="phone" required></label>
      <script>const phone=document.getElementById('phone');phone.oninput=()=>{const digits=phone.value.replace(/\\D/g,'');
        if(digits.startsWith('234'))phone.value=digits.slice(3).replace(/(\\d{3})(\\d{3})(\\d+)/,'$1 $2 $3');};</script></fieldset>''')
    return html


def test_phone_country_comes_from_profile_phone_not_residence_country():
    payload={**PAYLOAD,'applicantProfile':{'country':'USA','phone':'+2348000000000'}}
    result,posts=run(phone_group(),payload=payload,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
    assert any(a.get('selected_option')=='Nigeria +234' and a.get('source')=='edit_profile' for a in result['report']['answers'])
    assert b'800 000 0000' in posts[0] and b'Nigeria +234' in posts[0]


def test_phone_country_shared_prefix_requires_saved_country_disambiguation():
    payload={**PAYLOAD,'applicantProfile':{'country':'USA','phone':'+12025550123'}}
    result,posts=run(phone_group(),payload=payload,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
    assert any(a.get('selected_option')=='United States +1' for a in result['report']['answers'])
    unknown,posts=run(phone_group(),payload={**payload,'applicantProfile':{**payload['applicantProfile'],'country':'Nigeria'}},planner=build_plan)
    assert unknown['status']=='needs_attention' and not posts


def test_residence_country_is_unchanged_outside_explicit_phone_group():
    payload={'applicantProfile':{'country':'USA','phone':'+2348000000000'}}
    assert saved_profile_answer(payload,'Country',{'type':'combobox'})[0]=='USA'
    assert saved_profile_answer(payload,'Country',{'type':'combobox','phoneCountry':True})[0]=='+2348000000000'


def test_phone_group_dry_run_sends_nothing():
    result,posts=run(phone_group(),payload={**PAYLOAD,'applicantProfile':{'country':'USA','phone':'+2348000000000'}},planner=build_plan,submit=False)
    assert 'Dry run' in result['message'] and not posts,result
