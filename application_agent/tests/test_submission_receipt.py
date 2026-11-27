"""Fictional receipt/code UI only. No employer or real verification is contacted."""
import re
from types import SimpleNamespace
from application_agent.submission_receipt import receipt_match,public_receipt_url,observed_email_verification
from application_agent.manual_submit import confirmation_url


def test_expanded_receipt_wording_requires_an_actual_receipt_phrase():
    old=re.compile(r'Thank you for applying',re.I)
    for text in ['We have received your application.','Thank you for your interest in Example! We have received your application, and will review it.',"We've received your application",'WE HAVE SUCCESSFULLY RECEIVED YOUR APPLICATION']:
        assert receipt_match(text,old)
    for text in ['Thank you for your interest. Please enter your emailed code.','We have not received your application.','Your application has not been submitted.','We will review your application after verification.']:
        assert not receipt_match(text,old)


def test_embedded_confirmation_is_exact_to_public_board_and_vacancy_and_sanitized():
    before='https://job-boards.greenhouse.io/embed/job_app?for=fixture&token=123&validityToken=PRIVATE'
    confirmed='https://job-boards.greenhouse.io/embed/job_app/confirmation?for=fixture&token=123&validityToken=PRIVATE&email=PRIVATE#PRIVATE'
    assert confirmation_url(before,confirmed)
    assert public_receipt_url(confirmed)=='https://job-boards.greenhouse.io/embed/job_app/confirmation?for=fixture&token=123'
    for wrong in [confirmed.replace('token=123','token=456'),confirmed.replace('for=fixture','for=other'),confirmed.replace('job-boards.greenhouse.io','evil.example'),confirmed.replace('/confirmation','/confirmation-unverified'),confirmed.replace('token=123','token=123&token=456')]:
        assert not confirmation_url(before,wrong)
    assert public_receipt_url('https://employer.example/thanks?auth=PRIVATE#PRIVATE')=='https://employer.example/thanks'


def test_email_stage_reads_only_a_boolean_not_values_or_text():
    observed=[]
    def evaluate(script):observed.append(script);return True
    assert observed_email_verification([SimpleNamespace(evaluate=evaluate)])
    assert '.value' not in observed[0]
    assert not observed_email_verification([SimpleNamespace(evaluate=lambda _:False)])


def test_error_then_human_second_click_then_private_code_then_genuine_receipt():
    from contextlib import contextmanager
    from application_agent.manual_submit import ManualSubmit
    from application_agent.browser import execute_application
    from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan,browser_factory
    html=FORM.replace('{extra}',r'''<script>
      let attempts=0;
      document.querySelector('form').onsubmit=e=>{e.preventDefault();attempts++;
        document.querySelector('#submit-error')?.remove();
        if(attempts===1){const p=document.createElement('p');p.id='submit-error';p.textContent='Please complete the reCAPTCHA and resubmit your application.';document.body.append(p);}
        else {const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<p>Enter the verification code sent to your email.</p><input name="verification_code" autocomplete="one-time-code"><button type="button" id="verify-fixture">Verify fixture</button>';document.body.append(d);document.querySelector('#verify-fixture').onclick=()=>{document.body.textContent='We have received your application.';history.pushState({},'', '/embed/job_app/confirmation?for=fixture&token=123&validityToken=PRIVATE');};}
      };
    </script>''')
    calls=[];posts=[]
    class Actor(ManualSubmit):
        def minimize(self,context,page):self.page=page
        def window(self,context,page):page.get_by_role('button',name='Submit application').click()
        def api(self,path,body):
            calls.append(body)
            if not hasattr(self,'session'):self.session={'state':'ready','approvedHosts':[]}
            event=body['event']
            if event=='needs_submit':
                self.session['state']='needs_submit'
                assert self.page.locator('input[type=file]').evaluate('e=>e.files[0].name')=='chosen.pdf'
                self.page.get_by_role('button',name='Submit application').click()  # Synthetic human's second click.
            if event=='email_verification':
                self.session['verificationStage']='email_code'
                self.page.locator('[name=verification_code]').fill('FICTIONAL_TEST_ONLY')
                self.page.get_by_role('button',name='Verify fixture').click()  # Synthetic human completes fixture.
            if event=='confirmed':self.session['state']='confirmed';self.session['receipt']=body['evidence']
            return {'session':{**self.session,'openRequested':event=='poll' and len(calls)==2,'openCommandId':'fixture-open'}}
    actor=Actor(None,{'requestId':'fixture','claimId':'fixture-claim'},notify=None);actor.call=actor.api
    @contextmanager
    def factory():
        with browser_factory(html,posts) as runtime:
            launch=runtime.chromium.launch;runtime.chromium.launch=lambda **kw:launch(**{**kw,'headless':True});yield runtime
    payload={**PAYLOAD,'job':{**PAYLOAD['job'],'applyUrl':'https://job-boards.greenhouse.io/fixture/jobs/123'}}
    result=execute_application(payload,CV,submit=True,planner=plan,research_fn=lambda _:{},resolver=dns,timeout=1500,before_submit=lambda:True,playwright_factory=factory,manual_submit_handler=actor)
    assert result['status']=='applied',result
    assert not posts and result['report']['journey']['submit_click_attempts']==0
    assert 'email_verification' in [c['event'] for c in calls]
    assert result['receipt']=='We have received your application'
    assert result['evidence']['url'].endswith('/embed/job_app/confirmation?for=fixture&token=123')
    assert 'FICTIONAL_TEST_ONLY' not in str(calls) and 'PRIVATE' not in str(calls)


def test_saved_scoped_receipt_wins_closed_page_and_media_failure():
    from application_agent.manual_submit import ManualSubmit
    for closed in [False,True]:
        page=SimpleNamespace(url='https://job-boards.greenhouse.io/fixture/jobs/123',frames=[],is_closed=lambda:closed,on=lambda *_:None)
        context=SimpleNamespace(expose_binding=lambda *_:None,add_init_script=lambda *_:None)
        receipt={'url':page.url+'/confirmation','text':'We have received your application.'}
        actor=ManualSubmit(lambda *_:{'session':{'state':'confirmed','receipt':receipt}},{'requestId':'fixture','claimId':'fixture-claim'},notify=None);actor.human_attempts=1;actor.minimize=lambda *_:None
        def control(stage):
            if stage=='confirmed':raise OSError('Synthetic recorder failure')
        watch=SimpleNamespace(set_control=control,attach=lambda *_:None,capture=lambda **_:None)
        journey=SimpleNamespace(data={'version':1,'continue_click_attempts':0,'submit_click_attempts':0,'possible_delivery':True})
        result=actor.wait(context,page,{'journey':journey.data},journey,{'job-boards.greenhouse.io'},re.compile('Thank you for applying'),watch=watch)
        assert result['status']=='applied' and result['evidence']==receipt
