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


def test_missing_answer_keeps_exact_cv_and_browser_then_resumes_once():
    h=InputHandoff();posts=[]
    html=FORM.replace('{extra}','<label>What motivates you?<textarea name="motivation" required></textarea></label>')
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=800,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='applied',result
    assert len(posts)==1 and CV in posts[0] and b'I enjoy investigating security incidents.' in posts[0]
    assert [e['event'] for e in h.events]==['begin','opened','resumed']
    assert h.events[0]['kind']=='input' and h.events[0]['persistent']
    assert any(a['source']=='manual_browser' for a in result['report']['answers'])


def test_cancelled_missing_answer_does_not_submit_or_restart():
    h=InputHandoff(cancel=True);posts=[]
    html=FORM.replace('{extra}','<label>What motivates you?<input name="motivation" required></label>')
    result=execute_application(PAYLOAD,CV,submit=True,planner=plan,research_fn=lambda _: {},resolver=dns,timeout=800,
      before_submit=lambda:True,playwright_factory=lambda:hidden_factory(html,posts),verification_handler=h)
    assert result['status']=='needs_attention' and not posts


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
