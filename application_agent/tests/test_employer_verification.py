"""Intercepted fixtures only; no real CAPTCHA is loaded or completed."""
from application_agent.employer_verification import recaptcha_error,recaptcha_resource
from application_agent.tests.test_browser import FORM,run

ERROR='Please complete the reCAPTCHA and resubmit your application.'


def test_recognizes_the_recorded_error_without_confusing_a_privacy_badge():
    for text in [ERROR,'reCAPTCHA verification failed','Your reCAPTCHA is required','Invalid reCAPTCHA']:
        assert recaptcha_error(text)
    for text in ['This site is protected by reCAPTCHA.','Experience implementing CAPTCHA controls is useful.','Your application has been submitted.']:
        assert not recaptcha_error(text)


def test_resource_classification_grants_no_wildcard_or_private_destination():
    assert recaptcha_resource('https://www.google.com/recaptcha/enterprise.js?render=not-recorded')
    assert recaptcha_resource('https://www.gstatic.com/recaptcha/releases/fixture/script.js')
    for url in ['https://www.google.com.evil.test/recaptcha/api.js','http://www.google.com/recaptcha/api.js','https://user:pass@www.google.com/recaptcha/api.js','https://www.google.com/drive/','https://127.0.0.1/recaptcha/api.js']:
        assert not recaptcha_resource(url)


def test_error_after_submit_is_identified_without_replaying_or_claiming_delivery():
    html=FORM.replace('{extra}','')
    def employer(req):return '<p role="alert">'+ERROR+'</p>'+html if req.method=='POST' else html
    result,posts=run(employer)
    assert result['status']=='uncertain' and len(posts)==1,result
    assert result['report']['confirmation_wait']['outcome']=='verification_required'
    assert result['report']['journey']['submit_click_attempts']==1
    assert result['report']['journey']['possible_delivery'] is True
    assert result['report']['employer_verification']=={'service':'recaptcha','phase':'after_submit','state':'employer_error','manual_required':True,'submission_replayed':False}
    assert not result.get('receipt') and not result.get('evidence')


def test_client_rejected_submit_is_still_not_automatically_replayed():
    script='<script>document.querySelector("form").onsubmit=e=>{e.preventDefault();const p=document.createElement("p");p.setAttribute("role","alert");p.textContent='+repr(ERROR)+';document.body.append(p);};</script>'
    result,posts=run(FORM.replace('{extra}',script))
    assert result['status']=='uncertain' and not posts,result
    assert result['report']['journey']['submit_click_attempts']==1
    assert result['report']['employer_verification']['phase']=='after_submit'


def test_an_existing_employer_error_prevents_submit_without_changing_the_cv():
    result,posts=run(FORM.replace('{extra}','<p role="alert">'+ERROR+'</p>'))
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['journey']['submit_click_attempts']==0
    assert result['report']['journey']['cv_attached'] is True
    assert result['report']['employer_verification']['manual_required'] is True


def test_denied_recaptcha_script_is_diagnosed_before_submit_and_stays_denied():
    result,posts=run(FORM.replace('{extra}','<script src="https://www.google.com/recaptcha/enterprise.js?render=isolated-fixture"></script>'))
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['journey']['submit_click_attempts']==0
    assert result['report']['employer_verification']['state']=='resource_blocked'
    assert 'approved destinations' in result['message']


def test_normal_privacy_badge_does_not_block_an_otherwise_confirmed_submission():
    result,posts=run(FORM.replace('{extra}','<p>This site is protected by reCAPTCHA.</p>'))
    assert result['status']=='applied' and len(posts)==1,result
    assert not result['report'].get('employer_verification')


def test_a_recaptcha_connection_requested_only_on_submit_is_not_mislabeled_as_generic_timeout():
    script='''<script>document.querySelector('form').onsubmit=e=>{e.preventDefault();const s=document.createElement('script');s.src='https://www.google.com/recaptcha/enterprise.js?render=isolated-fixture';document.body.append(s);};</script>'''
    result,posts=run(FORM.replace('{extra}',script))
    assert result['status']=='uncertain' and not posts,result
    assert result['report']['journey']['submit_click_attempts']==1
    assert result['report']['confirmation_wait']['outcome']=='verification_required'
    assert result['report']['employer_verification']['state']=='resource_blocked'


def test_verification_error_after_continue_keeps_possible_delivery_and_never_repeats():
    html=FORM.replace('{extra}','').replace('Submit application','Continue')
    def employer(req):return '<p role="alert">'+ERROR+'</p>'+html if req.method=='POST' else html
    result,posts=run(employer)
    assert result['status']=='uncertain' and len(posts)==1,result
    assert result['report']['journey']['continue_click_attempts']==1
    assert result['report']['journey']['submit_click_attempts']==0
    assert result['report']['employer_verification']['phase']=='after_continue'
