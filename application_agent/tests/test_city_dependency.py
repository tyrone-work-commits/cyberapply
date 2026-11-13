from urllib.parse import urlencode
import pytest

from application_agent.browser import CITY_LOOKUP_HOST,allowed_city_lookup
from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import CV,FORM,PAYLOAD,run,dns,browser_factory
from application_agent.browser import execute_application
from application_agent.tests.test_static_assets import JOB,external_form,SCRIPT

LOOKUP=f'https://{CITY_LOOKUP_HOST}/v1/autocomplete?'+urlencode({'api_key':'public-fixture-key','layers':'locality','lang':'en','text':'Dallas'})
PROFILE={'city':'Dallas','country':'USA'}


def test_only_saved_city_locality_read_is_allowed():
    assert allowed_city_lookup(LOOKUP,'GET','fetch','job-boards.greenhouse.io',PROFILE)


@pytest.mark.parametrize('url,method,kind,origin,profile',[
    (LOOKUP,'POST','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP,'GET','document','job-boards.greenhouse.io',PROFILE),
    (LOOKUP.replace('Dallas','London'),'GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP+'&cv=private','GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP+'&text=Dallas','GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP.replace('locality','address'),'GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP.replace('/v1/autocomplete','/submit'),'GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP.replace(CITY_LOOKUP_HOST,CITY_LOOKUP_HOST+'.evil.example'),'GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP.replace('https:','http:'),'GET','fetch','job-boards.greenhouse.io',PROFILE),
    (LOOKUP,'GET','fetch','employer.example',PROFILE),
    (LOOKUP,'GET','fetch','job-boards.greenhouse.io',{}),
])
def test_city_read_cannot_be_an_application_or_data_channel(url,method,kind,origin,profile):
    assert not allowed_city_lookup(url,method,kind,origin,profile)


def test_city_fetch_can_load_but_stays_separate_from_submission_hosts():
    form,script=external_form(f"fetch('{LOOKUP}').catch(()=>{{}});");seen=[]
    def employer(req):
        seen.append(req.url)
        if req.url==SCRIPT:return {'body':script,'content_type':'text/javascript'}
        if req.url==LOOKUP:return {'body':'{"features":[]}','content_type':'application/json'}
        return form
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB,'applicantProfile':{**PROFILE,'country':'Nigeria'}},planner=build_plan,submit=False)
    assert 'Dry run' in result['message'] and not posts and LOOKUP in seen,result
    assert result['report']['navigation']['form_read_hosts']==[CITY_LOOKUP_HOST]
    assert CITY_LOOKUP_HOST not in result['report']['navigation']['automatic_application_hosts']
    assert result['report']['city_lookup']=={'status':'no_results','result_count':0}


@pytest.mark.parametrize('status',[200,503])
def test_empty_city_results_are_distinct_from_service_failures(status):
    html=FORM.replace('{extra}',f'''<label for="city">Location (City)</label><input role="combobox" id="city" aria-required="true" aria-expanded="false">
      <script>document.getElementById('city').oninput=()=>fetch('{LOOKUP}').catch(()=>{{}});</script>''')
    def employer(req):
        return {'body':'{"features":[]}','content_type':'application/json','status':status} if req.url==LOOKUP else html
    posts=[]
    result=execute_application({**PAYLOAD,'job':JOB,'applicantProfile':PROFILE},CV,submit=False,planner=build_plan,research_fn=lambda _:{},resolver=dns,
        playwright_factory=lambda:browser_factory(employer,posts),timeout=1000,before_submit=lambda:True)
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['city_lookup']['status']==('no_results' if status==200 else 'unavailable')
    assert (result['report']['unresolved'][0]['source']=='edit_profile')==(status==200),result
    assert ('full city name' in result['message'])==(status==200)
