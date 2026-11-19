"""Isolated employer form and video tests. No employer is contacted."""
import base64
import tempfile
from pathlib import Path
import av
from application_agent.browser import execute_application
from application_agent.verification_handoff import BrowserHandoff
from application_agent.video_encoder import RecordingEncoder
from application_agent.tests.test_video_encoder import jpeg
from application_agent.tests.test_browser import FORM,PAYLOAD,CV,dns,plan
from application_agent.tests.test_verification_handoff import hidden_factory


class InputHandoff(BrowserHandoff):
    def __init__(self,cancel=False):
        super().__init__(self.api,{'requestId':'one','claimId':'claim'})
        self.page=None;self.context=None;self.current=None;self.cancel=cancel;self.events=[]
    def window(self,context,page,state):
        if self.page:assert self.page is page and self.context is context
        self.page=page;self.context=context
    def api(self,path,body):
        if body:
            self.events.append(body)
            self.current={**(self.current or {}),**body,'state':'waiting' if body['event']=='begin' else body['event'],'approvedHosts':[]}
            if body['event']=='opened':
                # A simulated human supplies a fact; the production agent never invents it.
                self.page.get_by_label('What motivates you?').fill('I enjoy investigating security incidents.')
                self.page.get_by_role('button',name='Submit application').click()
        else:self.current['state']='cancelled' if self.cancel else 'opening' if self.current['state']=='waiting' else 'resuming'
        return {'handoff':self.current}


def test_missing_answer_returns_to_existing_in_app_question_editor_without_browser_handoff():
    h=InputHandoff();posts=[]
    html=FORM.replace('{extra}','<label>What motivates you?<textarea name="motivation" required></textarea></label>')
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=800,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='needs_attention',result
    assert not posts and not h.events
    assert any(q['question']=='What motivates you?' for q in result['report']['unresolved'])
    assert result['report']['journey']['possible_delivery'] is False


def test_ordinary_answer_pause_does_not_require_opening_or_cancelling_a_browser_handoff():
    h=InputHandoff(cancel=True);posts=[]
    html=FORM.replace('{extra}','<label>What motivates you?<input name="motivation" required></label>')
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=800,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='needs_attention' and not posts and not h.events


def test_downloaded_mp4_has_status_captions_in_its_actual_pixels():
    with tempfile.TemporaryDirectory() as directory:
        path=Path(directory)/'caption.mp4';encoder=RecordingEncoder(path)
        for label in ['agent','waiting','manual','resuming']:
            for _ in range(8):encoder.add(jpeg(),label)
        encoder.close()
        with av.open(str(path)) as movie:
            frames=list(movie.decode(video=0))
        assert len(frames)==32
        # Captions differ in decoded Y pixels, so downloads retain them.
        rows=[bytes(frames[index].planes[0])[504*frames[index].planes[0].line_size:] for index in [0,8,16,24]]
        assert len(set(rows))==4


def test_ordinary_dropdown_keeps_exact_employer_options_in_the_report_for_the_app():
    h=InputHandoff();posts=[]
    html=FORM.replace('{extra}',"<label>Source of work authorization<select name='work_source' required><option value=''>Choose</option><option>Citizen</option><option>Permanent resident</option><option>Sponsored work visa</option></select></label>")
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=800,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='needs_attention' and not posts and not h.events,result
    question=next(q for q in result['report']['questions'] if q['question']=='Source of work authorization')
    assert question['field_type']=='select'
    assert question['options']==['Choose','Citizen','Permanent resident','Sponsored work visa']
    assert any(q['question']=='Source of work authorization' for q in result['report']['unresolved'])
    assert result['report']['journey']['possible_delivery'] is False
