import re
import pytest

from application_agent.browser import allowed_static_asset,static_asset_hosts
from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import PAYLOAD,FORM,run
from application_agent.tests.test_combobox import dropdowns

CDN='job-boards.cdn.greenhouse.io'
SCRIPT=f'https://{CDN}/assets/form-test.js'
LOCALE=f'https://{CDN}/locales/en/common.'+'A'*43+'.json'
JOB={'applyUrl':'https://job-boards.greenhouse.io/huntress/jobs/test','url':'https://job-boards.greenhouse.io/huntress/jobs/test','company':'Fixture','title':'SOC Analyst'}


def test_greenhouse_static_host_is_separate_from_application_hosts():
    assert static_asset_hosts(JOB)=={CDN}
    assert static_asset_hosts({'applyUrl':'https://employer.example/apply'})==set()
    assert allowed_static_asset(SCRIPT,'GET','script',{CDN})
    assert allowed_static_asset(f'https://{CDN}/assets/entry-hash.css','GET','stylesheet',{CDN})
    assert allowed_static_asset(LOCALE,'GET','fetch',{CDN})


@pytest.mark.parametrize('url,method,kind',[
    (SCRIPT,'POST','script'),(SCRIPT,'GET','fetch'),(SCRIPT,'GET','document'),
    (SCRIPT+'?profile=private','GET','script'),(f'https://{CDN}/submit','GET','script'),
    (f'https://{CDN}.evil.example/assets/form-test.js','GET','script'),
    (f'https://user:password@{CDN}/assets/form-test.js','GET','script'),
    (f'http://{CDN}/assets/form-test.js','GET','script'),
    (f'https://{CDN}/assets/form-test.css','GET','script'),
    (f'https://{CDN}:bad/assets/form-test.js','GET','script'),
    (LOCALE,'POST','fetch'),(LOCALE+'?data=private','GET','fetch'),
    (LOCALE.replace('/en/','/unreviewed/'),'GET','fetch'),
    (LOCALE.replace('/common.','/application.'),'GET','fetch'),
])
def test_static_assets_cannot_be_used_for_data_or_navigation(url,method,kind):
    assert not allowed_static_asset(url,method,kind,{CDN})


def external_form(tail=''):
    form=dropdowns([{'label':'Country','options':['Nigeria']}])
    script=re.search(r'<script>(.*?)</script>',form,re.S).group(1)+tail
    return form.replace('<script>'+re.search(r'<script>(.*?)</script>',form,re.S).group(1)+'</script>',f'<script src="{SCRIPT}"></script>'),script


def test_provider_script_can_activate_dropdown_in_check_only_mode():
    form,script=external_form();seen=[]
    def response(req):
        seen.append((req.method,req.url))
        return {'body':script,'content_type':'text/javascript'} if req.url==SCRIPT else form
    result,posts=run(response,payload={**PAYLOAD,'job':JOB,'applicantProfile':{'country':'Nigeria'}},planner=build_plan,submit=False)
    assert result['status']=='needs_attention' and 'Dry run' in result['message'],result
    assert not posts and ('GET',SCRIPT) in seen
    assert any(a.get('selected_option')=='Nigeria' for a in result['report']['answers'])
    assert CDN not in result['report']['navigation']['automatic_application_hosts']


def test_provider_static_translations_can_load_without_opening_general_fetch():
    form,script=external_form(f"fetch('{LOCALE}').catch(()=>{{}});");seen=[]
    def response(req):
        seen.append(req.url)
        if req.url==SCRIPT:return {'body':script,'content_type':'text/javascript'}
        if req.url==LOCALE:return {'body':'{}','content_type':'application/json'}
        return form
    result,posts=run(response,payload={**PAYLOAD,'job':JOB,'applicantProfile':{'country':'Nigeria'}},planner=build_plan,submit=False)
    assert result['status']=='needs_attention' and 'Dry run' in result['message'] and not posts,result
    assert LOCALE in seen and 'blocked_destinations' not in result['report']


@pytest.mark.parametrize('method',['GET','POST'])
def test_unrelated_request_is_blocked_without_hiding_a_readable_form(method):
    form,script=external_form(f"fetch('https://unrelated.example/private?do-not-log=secret',{{method:'{method}'}}).catch(()=>{{}});");seen=[]
    def response(req):
        seen.append(req.url)
        return {'body':script,'content_type':'text/javascript'} if req.url==SCRIPT else form
    result,posts=run(response,payload={**PAYLOAD,'job':JOB,'applicantProfile':{'country':'Nigeria'}},planner=build_plan,submit=method=='POST')
    assert not posts and not any('unrelated.example' in url for url in seen)
    assert result['report']['blocked_destinations']==[{'host':'unrelated.example','method':method,'resource_type':'fetch'}]
    assert ('Dry run' in result['message'])==(method=='GET'),result


def test_check_only_can_inspect_after_an_aborted_external_write():
    form,script=external_form("fetch('https://unrelated.example/telemetry',{method:'POST'}).catch(()=>{});");seen=[]
    def response(req):
        seen.append(req.url)
        return {'body':script,'content_type':'text/javascript'} if req.url==SCRIPT else form
    result,posts=run(response,payload={**PAYLOAD,'job':JOB,'applicantProfile':{'country':'Nigeria'}},planner=build_plan,submit=False)
    assert 'Dry run' in result['message'] and not posts,result
    assert not any('unrelated.example' in url for url in seen)
    assert result['report']['blocked_destinations'][0]['method']=='POST'


@pytest.mark.parametrize('tail',[
    f"fetch('{SCRIPT}',{{method:'POST',body:'fixture-only'}}).catch(()=>{{}});",
    f"fetch('{SCRIPT}').catch(()=>{{}});",
])
def test_asset_host_blocks_post_and_fetch_even_for_a_valid_asset_path(tail):
    form,script=external_form(tail);seen=[]
    def response(req):
        seen.append((req.method,req.url))
        return {'body':script,'content_type':'text/javascript'} if req.url==SCRIPT else form
    result,posts=run(response,payload={**PAYLOAD,'job':JOB,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts,result
    assert seen.count(('GET',SCRIPT))==1 and all(method=='GET' for method,_ in seen)
    assert result['report']['blocked_destinations']==[{'host':CDN,'method':'POST' if "method:'POST'" in tail else 'GET','resource_type':'fetch'}]


def test_asset_host_is_not_an_application_submission_destination():
    form=FORM.replace('{extra}','').replace('action="/submit"',f'action="https://{CDN}/assets/form-test.js"')
    result,posts=run(form,payload={**PAYLOAD,'job':JOB})
    assert result['status']=='uncertain' and not posts,result


def test_unrelated_employer_does_not_gain_provider_asset_access():
    form,script=external_form();seen=[]
    def response(req):
        seen.append(req.url)
        return {'body':script,'content_type':'text/javascript'} if req.url==SCRIPT else form
    result,posts=run(response,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='needs_attention' and not posts,result
    assert SCRIPT not in seen


def test_dropdown_waits_for_a_delayed_aria_popup_relationship():
    form=dropdowns([{'label':'Country','options':['Nigeria']}],"const input=document.getElementById('combo0');input.removeAttribute('aria-controls');input.addEventListener('click',()=>setTimeout(()=>input.setAttribute('aria-controls','menu0'),90));")
    result,posts=run(form,payload={**PAYLOAD,'applicantProfile':{'country':'Nigeria'}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1,result
