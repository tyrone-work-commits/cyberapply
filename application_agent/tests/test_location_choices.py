from application_agent.location_choices import inspect_location_choices, run_location_capture
from application_agent.tests.test_browser import browser_factory, dns
from application_agent.tests.test_combobox import dropdowns

TASK={'applicationId':'app','captureId':'capture','cityQuery':'Dallas','job':{'url':'https://job-boards.greenhouse.io/fixture/jobs/123','source':{'provider':'greenhouse','region':'global','board':'fixture','externalId':'123','boardUrl':'https://job-boards.greenhouse.io/fixture'}}}


def read(html,task=TASK):
    posts=[]
    result=inspect_location_choices(task,playwright_factory=lambda:browser_factory(html,posts),resolver=dns,browser_channel=None,timeout=3000)
    return result,posts


def test_read_only_country_catalog_exceeds_100_and_never_fills_other_fields_or_posts():
    options=[f'Offered country {i} +{i+1}' for i in range(250)]
    html=dropdowns([{'label':'Country','options':options},{'label':'Salary','options':['Do not capture']}],"""document.getElementById('combo0').addEventListener('focus',()=>fetch('/autosave',{method:'POST',body:'must be blocked'}));document.querySelectorAll('[role=option]').forEach(e=>e.onclick=()=>fetch('/selected',{method:'POST'}));""")
    result,posts=read(html)
    assert not posts and result['code']==''
    assert [q['question'] for q in result['questions']]==['Country']
    assert result['questions'][0]['options']==options


def test_read_only_city_lookup_captures_offered_suggestions_without_selecting():
    html=dropdowns([{'label':'Location (City)*','options':[]}],"""const c=document.getElementById('combo0'),m=document.getElementById('menu0');c.addEventListener('input',()=>{m.setAttribute('aria-busy','true');setTimeout(()=>{m.innerHTML='<div role="option">Dallas, Texas, United States</div><div role="option">Dallas, Georgia, United States</div>';m.setAttribute('aria-busy','false');},200);});""")
    result,posts=read(html)
    assert not posts and result['questions'][0]['options']==['Dallas, Texas, United States','Dallas, Georgia, United States']
    assert result['questions'][0]['lookupQuery']=='Dallas'


def test_wrong_vacancy_and_invalid_queries_never_learn_options():
    result,posts=read(dropdowns([{'label':'Country','options':['Wrong']}]),{**TASK,'job':{**TASK['job'],'url':'https://job-boards.greenhouse.io/other/jobs/456'}})
    assert not posts and not result['questions']
    result,posts=read('unused',{**TASK,'cityQuery':'https://private.test'})
    assert not posts and not result['questions']


def test_menu_lane_never_calls_application_claim_cv_authorize_or_result(monkeypatch):
    calls=[]
    def call(site,token,path,data,**kw):
        calls.append((path,data))
        return {'task':TASK} if path.endswith('/claim') else {'recorded':True}
    monkeypatch.setattr('application_agent.location_choices.inspect_location_choices',lambda *a,**kw:{'questions':[],'code':'no_results'})
    assert run_location_capture('https://internal.test','not-a-real-token',call)
    assert [p for p,_ in calls]==['/api/application-agent/location-choices/claim','/api/application-agent/location-choices/result']
