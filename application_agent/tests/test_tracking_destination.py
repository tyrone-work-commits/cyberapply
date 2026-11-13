import pytest

from application_agent.browser import optional_tracking_request
from application_agent.tests.test_browser import CV,FORM,PAYLOAD,run
from application_agent.tests.test_static_assets import JOB


TRACKER='https://c.spl.greenhouse.io/com.snowplowanalytics.snowplow/tp2'
BOARD='job-boards.greenhouse.io'


def test_exact_observed_tracking_request_is_optional_but_not_allowed():
    assert optional_tracking_request(TRACKER,'POST','fetch',BOARD)
    assert optional_tracking_request(TRACKER,'POST','xhr',BOARD)


@pytest.mark.parametrize('url,method,kind,origin',[
    (TRACKER,'POST','document',BOARD),
    (TRACKER,'GET','fetch',BOARD),
    (TRACKER+'?data=private','POST','fetch',BOARD),
    (TRACKER+'#fragment','POST','fetch',BOARD),
    (TRACKER.replace('https:','http:'),'POST','fetch',BOARD),
    (TRACKER.replace('c.spl.greenhouse.io','c.spl.greenhouse.io.evil.example'),'POST','fetch',BOARD),
    (TRACKER.replace('c.spl.greenhouse.io','user:password@c.spl.greenhouse.io'),'POST','fetch',BOARD),
    (TRACKER.replace('/com.snowplowanalytics.snowplow/tp2','/submit'),'POST','fetch',BOARD),
    (TRACKER.replace('greenhouse.io/','greenhouse.io:bad/'),'POST','fetch',BOARD),
    (TRACKER,'POST','fetch','employer.example'),
])
def test_other_destinations_still_use_normal_boundary(url,method,kind,origin):
    assert not optional_tracking_request(url,method,kind,origin)


def tracked_form(extra=''):
    return FORM.replace('{extra}',f"<script>fetch('{TRACKER}',{{method:'POST',body:'tracker-must-never-receive-this'}}).catch(()=>{{}});{extra}</script>")


def test_tracking_is_aborted_while_one_real_application_can_complete():
    seen=[]
    def employer(req):
        seen.append(req.url)
        return 'Your application has been submitted' if req.method=='POST' else tracked_form()
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB})
    assert result['status']=='applied' and len(posts)==1 and CV in posts[0],result
    assert TRACKER not in seen
    assert 'unsupported' not in result['message']
    assert result['report']['suppressed_background_requests'][0]['host']=='c.spl.greenhouse.io'


def test_tracking_never_receives_a_dry_run_or_its_cv():
    seen=[]
    def employer(req):seen.append(req.url);return tracked_form()
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB},submit=False)
    assert 'Dry run' in result['message'] and not posts and TRACKER not in seen,result


def test_tracking_does_not_hide_an_unrelated_application_write():
    result,posts=run(tracked_form("fetch('https://unknown.example/submit',{method:'POST',body:'must-be-blocked'}).catch(()=>{});"),payload={**PAYLOAD,'job':JOB})
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['blocked_destinations'][0]['host']=='unknown.example'


def test_tracker_cannot_be_used_as_a_form_action_or_receipt_destination():
    html=FORM.replace('{extra}','').replace('action="/submit"',f'action="{TRACKER}"')
    result,posts=run(html,payload={**PAYLOAD,'job':JOB})
    assert result['status']=='uncertain' and not posts and 'receipt' not in result,result


def test_no_receipt_still_cannot_report_applied():
    result,posts=run(tracked_form(),payload={**PAYLOAD,'job':JOB},success=False)
    assert result['status']=='uncertain' and len(posts)==1 and 'receipt' not in result,result
