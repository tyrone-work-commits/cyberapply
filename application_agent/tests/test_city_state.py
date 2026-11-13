import pytest

from application_agent.combobox import option_matches
from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import PAYLOAD,run
from application_agent.tests.test_combobox import dropdowns

PROFILE={'city':'Dallas','state':'Texas','country':'USA','location':'Texas,USA'}
TEXAS='Dallas, Texas, United States'


def test_saved_state_disambiguates_employer_city_options():
    form=dropdowns([{'label':'Location (City)*','options':['Dallas, Oregon, United States',TEXAS,'Dallas, Georgia, United States'],'searchOnly':True}])
    result,posts=run(form,payload={**PAYLOAD,'applicantProfile':PROFILE},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
    answer=next(a for a in result['report']['answers'] if a['question']=='Location (City)*')
    assert answer['value']=='Dallas' and answer['source']=='edit_profile' and answer['selected_option']==TEXAS
    assert TEXAS.encode() in posts[0] and not result['report']['unresolved']


@pytest.mark.parametrize('label,expected',[
    (TEXAS,True),('Dallas, Oregon, United States',False),('Dallas, Texas, Canada',False),
    ('Lake Dallas, Texas, United States',False),('Dallas, Georgia, United States',False),
])
def test_city_country_and_saved_state_must_agree(label,expected):
    assert option_matches('Location (City)*','Dallas',label,PROFILE) is expected


@pytest.mark.parametrize('options,profile',[
    (['Dallas, Oregon, United States'],PROFILE),
    ([TEXAS,TEXAS],PROFILE),
    ([TEXAS,'Dallas, Oregon, United States'],{'city':'Dallas','country':'USA'}),
])
def test_missing_state_wrong_state_or_duplicate_city_options_never_submit(options,profile):
    result,posts=run(dropdowns([{'label':'Location (City)*','options':options,'searchOnly':True}]),payload={**PAYLOAD,'applicantProfile':profile},planner=build_plan)
    assert result['status']=='needs_attention' and not posts,result
