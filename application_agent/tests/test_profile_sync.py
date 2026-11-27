"""Only isolated synthetic forms; no employer or live verification is contacted."""
import copy
from application_agent.profile_sync import ProfileSync
from application_agent.tests.test_browser import PAYLOAD,CV,dns
from application_agent.tests.test_verification_handoff import FixtureHandoff,hidden_factory
from application_agent.browser import execute_application
from application_agent.reasoning import build_plan

def test_sync_refills_same_form_keeps_cv_and_handoff_then_submits_once():
    payload=copy.deepcopy(PAYLOAD);payload.update(claimId='fixture-claim',applicantProfile={'city':'Old City','employerQuestions':[{'question':'Preferred shift','fieldType':'select','answer':'Day','source':'user','updatedAt':'2026-11-25','options':['Day','Night']}]})
    target={'city':'New City','employerQuestions':[{'question':'Preferred shift','fieldType':'select','answer':'Night','source':'user','updatedAt':'2026-11-26','options':['Day','Night']}]}
    class Handoff(FixtureHandoff):
        def __init__(self):
            super().__init__();self.sent=False;self.acked=False;self.pause_ids=[]
            self.profile_sync=ProfileSync(self.api,payload)
        def api(self,path,body):
            if path.startswith('/api/application-agent/profile-sync'):
                if body:
                    assert self.page.get_by_label('City',exact=True).input_value()=='New City'
                    assert self.page.get_by_label('Preferred shift').input_value()=='Night'
                    assert self.page.locator('input[type=file]').evaluate('e=>e.files[0].name')=='chosen.pdf'
                    assert body['id']=='saved-revision' and 'code' not in body
                    self.acked=True;return {'sync':{'state':'applied'}}
                if not self.sent:
                    self.sent=True
                    return {'sync':{'id':'saved-revision','claimId':'fixture-claim','state':'pending'},'applicantProfile':target,'confirmedAnswers':[]}
                return {'sync':None}
            if body and body.get('event')=='begin':self.pause_ids.append(body['id'])
            return super().api(path,body)
    h=Handoff();posts=[]
    html='''<form action="/submit" method="post" enctype="multipart/form-data">
    <label>Email<input name="email" type="email" required></label><label>City<input name="city" required></label>
    <label>Preferred shift<select name="shift"><option>Day</option><option>Night</option></select></label>
    <label>Resume<input type="file" name="cv" required></label>
    <label>Which of the following best describes you?<select required name="manual"><option value="">Choose</option><option value="done">I am a human</option><option>I am an AI agent</option></select></label>
    <button type="submit">Submit application</button></form>'''
    result=execute_application(payload,CV,submit=True,planner=build_plan,research_fn=lambda _: {},resolver=dns,timeout=1000,before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='applied',result
    assert h.acked and len(h.pause_ids)==2 and len(set(h.pause_ids))==1
    assert len(posts)==1 and b'New City' in posts[0] and b'Night' in posts[0] and CV in posts[0]
    assert result['report']['journey']['submit_click_attempts']==1
    assert len([x for x in result['report']['verification_handoffs'] if x.get('completed_by_user')])==1

def test_foreign_sync_revision_cannot_replace_task_or_cv():
    task={'requestId':'one','claimId':'claim','cv':{'sha256':'original'},'applicantProfile':{'city':'Old'}}
    sync=ProfileSync(lambda *args:{'sync':{'id':'x','state':'pending','claimId':'other'},'applicantProfile':{'city':'New'},'confirmedAnswers':[]},task)
    import pytest
    with pytest.raises(ValueError):sync.poll()
    assert task['applicantProfile']['city']=='Old' and task['cv']['sha256']=='original'
