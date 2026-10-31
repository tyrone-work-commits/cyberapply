import hashlib
from contextlib import contextmanager

import pytest

from application_agent.browser import ApplicationAttention, execute_application, validate_public_url
from application_agent.runner import parse_connection
from application_agent.browser import automatic_application_hosts


CV = b'Private selected CV bytes'
PAYLOAD = {'requestId':'one', 'job':{'applyUrl':'https://employer.example/apply','company':'Example','title':'Security analyst'},
           'cv':{'name':'chosen.pdf','type':'application/pdf','sha256':hashlib.sha256(CV).hexdigest(),'text':'Alex alex@example.com'}}
FORM = '''<html><body><form action="/submit" method="post" enctype="multipart/form-data">
<label>Email<input type="email" name="email" required></label>
<label>Resume<input type="file" name="resume" required></label>
{extra}<button type="submit">Submit application</button></form></body></html>'''


def dns(_host, _port, **_kw):
    return [(2,1,6,'',('93.184.216.34',443))]


def plan(_payload, fields, _research):
    return {'answers':[{'field_id':f['id'],'value':'alex@example.com','source':'cv','evidence':'alex@example.com'} for f in fields if f['label']=='Email'],
            'unresolved':[], 'cover_letter':'I can contribute the skills described in my CV.', 'experience':{'cybersecurity_years':1}}


@contextmanager
def browser_factory(html, posts, success=True):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        class Context:
            def __init__(self, context): self.context=context
            def __getattr__(self,name):return getattr(self.context,name)
            def route_web_socket(self,*args,**kwargs): return self.context.route_web_socket(*args,**kwargs)
            def add_init_script(self,*args,**kwargs): return self.context.add_init_script(*args,**kwargs)
            def route(self, pattern, guard):
                def dispatch(route):
                    class Route:
                        request=route.request
                        def continue_(self):
                            if route.request.method=='POST':
                                posts.append(route.request.post_data_buffer)
                                body=html(route.request) if callable(html) else 'Your application has been submitted' if success else 'Unexpected reply'
                            else:
                                body=html(route.request) if callable(html) else html
                            if isinstance(body,dict):
                                route.fulfill(status=body.get('status',200),content_type=body.get('content_type','text/html'),body=body['body'])
                            else:route.fulfill(status=200,content_type='text/html',body=body)
                        def abort(self): route.abort()
                    guard(Route())
                self.context.route(pattern,dispatch)
            def new_page(self): return self.context.new_page()
        class Browser:
            def __init__(self, browser): self.browser=browser
            def new_context(self,**kw): return Context(self.browser.new_context(**kw))
            def close(self): self.browser.close()
        class Chromium:
            def launch(self,**kw): return Browser(pw.chromium.launch(channel='chrome',**kw))
        class Runtime:
            chromium=Chromium()
        yield Runtime()


def run(html, *, submit=True, success=True, cv=CV, payload=PAYLOAD, planner=plan):
    posts=[]
    result=execute_application(payload,cv,submit=submit,planner=planner,research_fn=lambda _:{'sources':[]},resolver=dns,
                               playwright_factory=lambda:browser_factory(html,posts,success),timeout=3000,before_submit=lambda:True)
    return result,posts

def test_profile_contact_and_salary_reach_form_with_exact_cv():
    from application_agent.reasoning import build_plan
    payload={**PAYLOAD,'applicantProfile':{'location':'Abuja, Nigeria','phone':'+2348012345678','expectedSalary':{'amount':2000,'currency':'USD','period':'month'}}}
    html=FORM.replace('{extra}','<label>Location<input name="location" required></label><label>Phone number<input name="phone" required></label><label>Expected annual salary USD<input name="salary" inputmode="decimal" required></label>')
    result,posts=run(html,payload=payload,planner=build_plan)
    assert result['status']=='applied'
    assert len(posts)==1 and b'Abuja, Nigeria' in posts[0] and b'+2348012345678' in posts[0] and b'24000' in posts[0]
    assert CV in posts[0]
    assert all(answer['source']=='edit_profile' for answer in result['report']['answers'] if answer['question'] in {'Location','Phone number','Expected annual salary USD'})

def test_missing_profile_contact_stops_before_any_submission():
    from application_agent.reasoning import build_plan
    result,posts=run(FORM.replace('{extra}','<label>City<input name="city" required></label>'),planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    assert any('Edit Profile' in question['reason'] for question in result['report']['unresolved'])

def test_account_full_name_city_country_and_cv_linkedin_reach_real_controls():
    from application_agent.reasoning import build_plan
    payload={**PAYLOAD,'applicantProfile':{'fullName':'Account Full Name','city':'Abuja','country':'NG','location':'Abuja, Nigeria'},
      'cv':{**PAYLOAD['cv'],'text':'Different CV Name\nalex@example.com\nhttps://www.linkedin.com/in/from-chosen-cv'},
      'confirmedAnswers':[{'question':'Please provide LinkedIn profile','value':'https://linkedin.com/in/stale'}]}
    html=FORM.replace('{extra}','<label>First name<input name="first" required></label><label>Last name<input name="last" required></label><label>Location (City)<input name="city" required></label><label>Country<select name="country" required><option>United Kingdom</option><option>Nigeria</option></select></label><label>Please provide LinkedIn profile<input name="linkedin" required></label>')
    result,posts=run(html,payload=payload,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1
    body=posts[0]
    assert body.count(b'Account Full Name')==2 and b'Abuja' in body and b'Nigeria' in body and b'https://www.linkedin.com/in/from-chosen-cv' in body
    assert b'https://linkedin.com/in/stale' not in body and b'Different CV Name' not in body

@pytest.mark.parametrize('country,city,expected',[('USA','Dallas','No'),('UK','London','Yes'),('Ireland','Dublin','Yes')])
def test_residence_and_work_rights_are_independent_native_radio_answers(country,city,expected):
    from application_agent.reasoning import build_plan
    html=FORM.replace('{extra}','<fieldset><legend>Are you located in the United Kingdom or Ireland?</legend><label>Yes<input type="radio" name="residence" value="yes" required></label><label>No<input type="radio" name="residence" value="no" required></label></fieldset><fieldset><legend>Are you authorized to work in the United States?</legend><label>Yes<input type="radio" name="rights" value="yes" required></label><label>No<input type="radio" name="rights" value="no" required></label></fieldset>')
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'country':country,'city':city,'location':f'{city}, {country}','usaRightToWork':True}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1
    assert any(a['question'].startswith('Are you located') and a['value']==expected for a in result['report']['answers'])
    assert any(a['question'].startswith('Are you authorized') and a['value']=='Yes' for a in result['report']['answers'])

def test_generated_answer_pauses_until_its_exact_text_is_approved():
    from application_agent.reasoning import build_plan
    question='Why are you interested in this role?'
    html=FORM.replace('{extra}',f'<label>{question}<textarea name="motivation" required></textarea></label>')
    pending,posts=run(html,planner=build_plan)
    assert pending['status']=='needs_attention' and not posts
    draft=next(item for item in pending['report']['unresolved'] if item.get('source')=='generated')
    payload={**PAYLOAD,'confirmedAnswers':[{'question':question,'value':draft['suggested_value']}]}
    approved,posts=run(html,planner=build_plan,payload=payload)
    assert approved['status']=='applied' and draft['suggested_value'].encode() in posts[0]

def test_saved_visa_and_work_rights_fill_native_select_and_radio():
    from application_agent.reasoning import build_plan
    html=FORM.replace('{extra}','<label>Do you need a work visa for UK?<select name="visa" required><option>Yes</option><option>No</option></select></label><fieldset><legend>Are you authorized to work in UK?</legend><label>Yes<input type="radio" name="rights" value="yes" required></label><label>No<input type="radio" name="rights" value="no" required></label></fieldset>')
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'ukVisaRequired':True,'ukRightToWork':False}},planner=build_plan)
    assert result['status']=='applied' and b'Yes' in posts[0] and b'no' in posts[0]
    assert any(answer['source']=='edit_profile' and answer['value']=='No' for answer in result['report']['answers'])

def test_uk_or_ireland_work_rights_fill_yes_if_selected_else_no():
    from application_agent.reasoning import build_plan
    html=FORM.replace('{extra}','<fieldset><legend>Are you authorized to work in the United Kingdom or Ireland for any employer?</legend><label>Yes<input type="radio" name="rights" value="yes" required></label><label>No<input type="radio" name="rights" value="no" required></label></fieldset><label>Do you require a work visa for Ireland?<select name="visa" required><option>Yes</option><option>No</option></select></label>')
    profile={'ukRightToWork':False,'irelandRightToWork':True,'irelandVisaRequired':False}
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':profile},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1 and b'yes' in posts[0] and b'No' in posts[0]
    result,posts=run(html,payload={**PAYLOAD,'applicantProfile':{'ukRightToWork':False,'irelandVisaRequired':False}},planner=build_plan)
    assert result['status']=='applied' and len(posts)==1 and b'no' in posts[0]
    assert any(answer.get('value')=='No' and 'User-selected rule' in answer.get('evidence','') for answer in result['report']['answers'])

def test_generated_cover_letter_is_uploaded_only_after_approval():
    from application_agent.reasoning import build_plan
    html=FORM.replace('{extra}','<label>Cover letter<input type="file" name="letter" required></label>')
    result,posts=run(html,planner=build_plan)
    assert result['status']=='needs_attention' and not posts
    approved='This exact cover letter was reviewed and approved for this job.'
    result,posts=run(html,payload={**PAYLOAD,'confirmedAnswers':[{'question':'Cover letter','value':approved}]},planner=build_plan)
    assert result['status']=='applied' and approved.encode() in posts[0]


def test_blocks_local_and_unapproved_hosts():
    with pytest.raises(ApplicationAttention):
        validate_public_url('https://employer.example',resolver=lambda *a,**k:[(2,1,6,'',('127.0.0.1',443))])
    with pytest.raises(ApplicationAttention):
        validate_public_url('https://evil.example',{'employer.example'},dns)
    with pytest.raises(ApplicationAttention):
        validate_public_url('http://employer.example',resolver=dns)


AUTH_STATE={'cookies':[{'name':'login','value':'test-session','domain':'employer.example','path':'/','expires':-1,'httpOnly':True,'secure':True,'sameSite':'Lax'}],'origins':[]}

class MemorySessions:
    def __init__(self,state=None):self.state=state;self.saves=[]
    def load(self,job,hosts):return self.state
    def save(self,job,hosts,state,refresh=False):self.state=state;self.saves.append((state,refresh))

def protected_form(req):
    if req.method=='POST':return 'Your application has been submitted'
    if 'login=test-session' in req.headers.get('cookie',''):return FORM.replace('{extra}','')
    return '<form><label>Password<input type="password"></label><button>Sign in</button></form>'

def test_saved_login_session_is_reused_without_prompt():
    posts=[];store=MemorySessions(AUTH_STATE)
    def no_prompt(*args):raise AssertionError('Existing valid sign-in should be automatic')
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
      playwright_factory=lambda:browser_factory(protected_form,posts),before_submit=lambda:True,timeout=3000,
      session_store=store,interactive_login=True,login_handler=no_prompt)
    assert result['status']=='applied' and len(posts)==1 and result['report']['login_session']['reused']

def test_first_private_sign_in_resumes_and_saves_only_scoped_state():
    posts=[];store=MemorySessions();calls=[]
    def signed_in(*args):calls.append(True);return {'state':AUTH_STATE,'url':'https://employer.example/apply'}
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
      playwright_factory=lambda:browser_factory(protected_form,posts),before_submit=lambda:True,timeout=3000,
      session_store=store,interactive_login=True,login_handler=signed_in)
    assert result['status']=='applied' and len(posts)==1 and len(calls)==1
    assert result['report']['login_session']['saved'] and store.saves

def test_cancelled_sign_in_never_submits_or_saves_a_session():
    posts=[];store=MemorySessions()
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
      playwright_factory=lambda:browser_factory(protected_form,posts),before_submit=lambda:True,timeout=3000,
      session_store=store,interactive_login=True,login_handler=lambda *args:None)
    assert result['status']=='needs_attention' and not posts and not store.saves

def test_revocation_after_sign_in_prevents_saving_and_submission():
    posts=[];store=MemorySessions();auth=iter([True,False])
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
      playwright_factory=lambda:browser_factory(protected_form,posts),before_submit=lambda:next(auth),timeout=3000,
      session_store=store,interactive_login=True,login_handler=lambda *args:{'state':AUTH_STATE})
    assert result['status']=='needs_attention' and not posts and not store.saves

def test_login_after_possible_partial_delivery_never_restarts_application():
    posts=[];store=MemorySessions()
    def page(req):
        if req.url.endswith('/step2'):return '<input type="password" aria-label="Password">'
        return FORM.replace('{extra}','').replace('/submit','/step2').replace('Submit application','Continue')
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
      playwright_factory=lambda:browser_factory(page,posts),before_submit=lambda:True,timeout=3000,
      session_store=store,interactive_login=True,login_handler=lambda *args:(_ for _ in ()).throw(AssertionError('Must not restart partial application')))
    assert result['status']=='uncertain' and len(posts)==1


def test_provider_aliases_are_automatic_exact_and_region_scoped():
    aliases=automatic_application_hosts({'url':'https://boards.greenhouse.io/company/jobs/123'})
    assert 'job-boards.greenhouse.io' in aliases and 'jobs.lever.co' not in aliases
    assert automatic_application_hosts({'url':'https://job-boards.greenhouse.io.evil.example/job'})==set()
    assert 'jobs.lever.co' not in automatic_application_hosts({'url':'https://jobs.eu.lever.co/company/job'})


def test_greenhouse_board_transition_follows_apply_link_without_approval():
    payload={**PAYLOAD,'job':{**PAYLOAD['job'],'url':'https://boards.greenhouse.io/company/jobs/123','applyUrl':'https://boards.greenhouse.io/company/jobs/123'}}
    def html(req):
        if 'boards.greenhouse.io/company/jobs/123' in req.url and 'job-boards' not in req.url:
            return '<a href="https://job-boards.greenhouse.io/company/jobs/123">Apply</a>'
        return FORM.replace('{extra}','') if req.method=='GET' else 'Your application has been submitted'
    result,posts=run(html,payload=payload)
    assert result['status']=='applied' and len(posts)==1
    assert result['evidence']['url'].startswith('https://job-boards.greenhouse.io/')
    assert 'job-boards.greenhouse.io' in result['report']['navigation']['automatic_application_hosts']


def test_lever_form_endpoint_is_automatic_without_extra_host_argument():
    payload={**PAYLOAD,'job':{**PAYLOAD['job'],'applyUrl':'https://jobs.lever.co/company/job'}}
    result,posts=run(FORM.replace('{extra}','').replace('action="/submit"','action="https://api.lever.co/submit"'),payload=payload)
    assert result['status']=='applied' and len(posts)==1


def test_optional_unrelated_image_is_blocked_without_stalling_form():
    result,posts=run(FORM.replace('{extra}','<img src="https://unrelated.example/pixel">'))
    assert result['status']=='applied' and len(posts)==1


def test_unknown_form_destination_never_receives_cv():
    result,posts=run(FORM.replace('{extra}','').replace('action="/submit"','action="https://unrelated.example/submit"'))
    assert result['status']=='uncertain' and not posts


def test_exact_cv_uploaded_and_explicit_confirmation_required():
    result,posts=run(FORM.replace('{extra}',''))
    assert result['status']=='applied'
    assert len(posts)==1 and CV in posts[0]
    assert b'filename="chosen.pdf"' in posts[0]
    assert result['evidence']['url']=='https://employer.example/submit'
    assert result['report']['answers'][0]['question']=='Email'


def test_dry_run_never_submits():
    result,posts=run(FORM.replace('{extra}',''),submit=False)
    assert result['status']=='needs_attention'
    assert not posts
    assert 'Dry run' in result['message']


def test_unknown_required_question_and_consent_pause():
    for extra in ('<label>Legal work authorization<input name="legal" required></label>',
                  '<label><input type="checkbox" name="consent" required>I agree to processing</label>'):
        result,posts=run(FORM.replace('{extra}',extra))
        assert result['status']=='needs_attention'
        assert result['report']['unresolved'] and not posts


def test_ambiguous_confirmation_is_uncertain_no_retry():
    result,posts=run(FORM.replace('{extra}',''),success=False)
    assert result['status']=='uncertain' and len(posts)==1
    assert 'receipt' not in result


def test_changed_cv_stops_before_browser():
    result,posts=run(FORM.replace('{extra}',''),cv=b'different bytes')
    assert result['status']=='needs_attention' and not posts


def test_password_form_pauses_without_submission():
    result,posts=run(FORM.replace('{extra}','<input type="password" required>'))
    assert result['status']=='needs_attention' and 'sign-in' in result['message'] and not posts


def test_conditional_question_is_inspected_before_submit():
    extra='''<script>document.querySelector('[name=email]').addEventListener('input',()=>{
      if (!document.querySelector('[name=authorization]')) {const input=document.createElement('input');input.name='authorization';input.required=true;input.setAttribute('aria-label','Work authorization');document.querySelector('form').append(input);}
    })</script>'''
    result,posts=run(FORM.replace('{extra}',extra))
    assert result['status']=='needs_attention' and not posts
    assert any('authorization' in x['question'] for x in result['report']['unresolved'])


def test_revoked_authorization_prevents_final_click():
    posts=[]
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,
      playwright_factory=lambda:browser_factory(FORM.replace('{extra}',''),posts),before_submit=lambda:False,timeout=3000)
    assert result['status']=='needs_attention' and not posts
    assert 'authorization' in result['message']


def test_stale_confirmation_in_iframe_cannot_mark_applied():
    def html(req):
        if req.url.endswith('/receipt'):
            return '<body>Your application has been submitted</body>'
        return FORM.replace('{extra}','<iframe src="/receipt"></iframe>')
    result,posts=run(html)
    assert result['status']=='needs_attention' and not posts
    assert 'already' in result['message']


def test_dry_run_does_not_click_continue_or_save_partial_application():
    result,posts=run(FORM.replace('{extra}','').replace('Submit application','Continue'),submit=False)
    assert result['status']=='needs_attention' and not posts
    assert 'Advancing' in result['message']


def test_multi_step_reinspects_new_required_questions():
    def html(req):
        if req.url.endswith('/step2'):
            return '<form action="/submit" method="post"><label>Work authorization<input required name="legal"></label><button>Submit application</button></form>'
        return FORM.replace('{extra}','').replace('/submit','/step2').replace('Submit application','Continue')
    result,posts=run(html)
    assert result['status']=='uncertain' and len(posts)==1
    assert any(x['question']=='Work authorization' for x in result['report']['unresolved'])


def test_dns_address_change_blocks_before_browser():
    calls=[]
    def rebinding(host,port,**kw):
        calls.append(host)
        return dns(host,port,**kw) if len(calls)<3 else [(2,1,6,'',('127.0.0.1',443))]
    result=execute_application(PAYLOAD,CV,resolver=rebinding,planner=plan,research_fn=lambda _:{})
    assert result['status']=='needs_attention' and 'non-public' in result['message']


def test_connection_bundle_is_bound_to_exact_site_and_legacy_tokens_rejected():
    import json
    site='https://cyberapply.example'
    token='ca2.owner.'+'a'*64
    assert parse_connection(json.dumps({'token':token,'serviceToken':'private','site':site}),site)==(token,'private')
    with pytest.raises(ValueError):
        parse_connection(json.dumps({'token':token,'serviceToken':'private','site':'https://other.example'}),site)
    with pytest.raises(ValueError):
        parse_connection('old-pairing-token',site)


def test_exact_user_confirmed_consent_can_be_checked():
    from application_agent.reasoning import build_plan
    payload={**PAYLOAD,'confirmedAnswers':[{'question':'I agree to processing','value':'true'}]}
    result,posts=run(FORM.replace('{extra}','<label><input type="checkbox" name="consent" required>I agree to processing</label>'),payload=payload,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1
    assert b'name="consent"' in posts[0]
    assert any(answer.get('question')=='I agree to processing' for answer in result['report']['answers'])


def test_explicit_radio_selects_only_the_exact_option():
    from application_agent.reasoning import build_plan
    payload={**PAYLOAD,'confirmedAnswers':[{'question':'Work authorization','value':'Yes'}]}
    extra='''<fieldset><legend>Work authorization</legend><label><input type="radio" name="work" value="yes" required>Yes</label><label><input type="radio" name="work" value="no">No</label></fieldset>'''
    result,posts=run(FORM.replace('{extra}',extra),payload=payload,planner=build_plan)
    assert result['status']=='applied' and len(posts)==1
    assert b'name="work"\r\n\r\nyes' in posts[0] and b'name="work"\r\n\r\nno' not in posts[0]
    assert any(answer.get('question')=='Work authorization' for answer in result['report']['answers'])


def test_optional_employer_default_opt_ins_are_cleared():
    extra='''<label><input type="checkbox" name="marketing" checked>Send marketing</label>
      <fieldset><legend>Gender</legend><label><input type="radio" name="gender" value="female" checked>Female</label><label><input type="radio" name="gender" value="male">Male</label></fieldset>'''
    result,posts=run(FORM.replace('{extra}',extra))
    assert result['status']=='applied' and len(posts)==1
    assert b'name="marketing"' not in posts[0] and b'name="gender"' not in posts[0]


def test_other_question_confirmation_cannot_accept_consent():
    from application_agent.reasoning import build_plan
    payload={**PAYLOAD,'confirmedAnswers':[{'question':'I agree to other processing','value':'true'}]}
    result,posts=run(FORM.replace('{extra}','<label><input type="checkbox" name="consent" required>I agree to processing</label>'),payload=payload,planner=build_plan)
    assert result['status']=='needs_attention' and not posts


def test_duplicate_vague_consent_labels_need_separate_review():
    from application_agent.reasoning import build_plan
    payload={**PAYLOAD,'confirmedAnswers':[{'question':'I agree','value':'true'}]}
    extra='<label><input type="checkbox" name="one" required>I agree</label><label><input type="checkbox" name="two" required>I agree</label>'
    result,posts=run(FORM.replace('{extra}',extra),payload=payload,planner=build_plan)
    assert result['status']=='needs_attention' and not posts


def test_employer_script_cannot_silently_change_prepared_answer():
    extra='''<script>document.querySelector('[name=resume]').addEventListener('change',()=>{document.querySelector('[name=email]').value='changed@example.com'})</script>'''
    result,posts=run(FORM.replace('{extra}',extra))
    assert result['status']=='needs_attention' and not posts
    assert 'changed after preparation' in result['message']


def test_employer_script_cannot_open_websocket_or_peer_transports():
    extra='''<script>
      let blocked=0;
      for (const start of [()=>new WebSocket('wss://unapproved.example/socket'),
                          ()=>new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1'}]}),
                          ()=>new WebTransport('https://unapproved.example')]) {
        try {start()} catch {blocked++}
      }
      const proof=document.createElement('input');proof.type='hidden';proof.name='transports_blocked';proof.value=String(blocked);document.querySelector('form').append(proof);
    </script>'''
    result,posts=run(FORM.replace('{extra}',extra))
    assert result['status']=='applied' and len(posts)==1
    assert b'name="transports_blocked"\r\n\r\n3' in posts[0]
