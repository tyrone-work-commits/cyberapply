from application_agent.tests.test_browser import FORM, PAYLOAD, run
from application_agent.tests.test_journey import JOB


def test_anchor_loop_stops_without_reload_writes_or_submit():
    gets=[]
    def employer(req):
        gets.append(req.url)
        return '<body><a href="#apply">Apply Now</a><div id="apply">Form unavailable</div><script>fetch("/metrics",{method:"POST",body:"not an application"}).catch(()=>{});</script></body>'
    result,posts=run(employer)
    assert result['status']=='needs_attention' and not posts,result
    assert len(gets)==1 and result['report']['journey']['stop_reason']=='application_link_loop'
    assert result['report']['journey']['submit_click_attempts']==0
    assert result['report']['journey']['possible_delivery'] is False


def test_matching_feed_embed_is_followed_without_logging_its_signed_url():
    seen=[]
    def employer(req):
        seen.append(req.url)
        if req.method=='POST':return 'Your application has been submitted'
        if '/embed/job_app' in req.url:return FORM.replace('{extra}','')
        return '<body><a href="#apply">Apply Now</a><div id="apply"><iframe src="https://job-boards.greenhouse.io/embed/job_app?for=fixture&amp;token=123&amp;validityToken=private-embed-ticket"></iframe></div></body>'
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB})
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['entry']=='matching_greenhouse_embed'
    assert result['report']['journey']['cv_attached'] is True
    assert 'private-embed-ticket' not in str(result['report'])


def test_more_than_six_real_pages_can_complete_without_replaying_submit():
    def employer(req):
        if req.url.endswith('/done'):return 'Your application has been received'
        step=int(req.url.rsplit('/step',1)[1]) if '/step' in req.url else 1
        target=f'/step{step+1}' if step<8 else '/done'
        return FORM.replace('{extra}','').replace('/submit',target).replace('Submit application','Continue' if step<8 else 'Submit application')
    result,posts=run(employer)
    assert result['status']=='applied' and len(posts)==8,result
    assert result['report']['journey']['continue_click_attempts']==7
    assert result['report']['journey']['submit_click_attempts']==1


def test_continue_that_finishes_application_is_confirmed_without_another_click():
    result,posts=run(FORM.replace('{extra}','').replace('Submit application','Continue'))
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['continue_click_attempts']==1
    assert result['report']['journey']['submit_click_attempts']==0


def test_other_employer_embed_never_receives_the_cv():
    seen=[]
    def employer(req):
        seen.append(req.url)
        if 'greenhouse.io' in req.url:return FORM.replace('{extra}','')
        return '<body><iframe src="https://job-boards.greenhouse.io/embed/job_app?for=someoneelse&amp;token=456"></iframe></body>'
    result,posts=run(employer,payload={**PAYLOAD,'job':JOB})
    assert result['status']=='needs_attention' and not posts,result
    assert not any('someoneelse' in url for url in seen)
    assert result['report']['journey']['cv_attached'] is False


def test_delayed_receipt_after_continue_is_waited_for_without_replaying_click():
    html=FORM.replace('Submit application','Continue').replace('{extra}',"""<script>document.querySelector('form').onsubmit=event=>{
      event.preventDefault();fetch('/submit',{method:'POST',body:new FormData(event.target)}).then(()=>{
        setTimeout(()=>document.body.textContent='Thank you for applying',1300);
      });};</script>""")
    def employer(req):return 'Accepted' if req.method=='POST' else html
    result,posts=run(employer)
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['journey']['continue_click_attempts']==1
