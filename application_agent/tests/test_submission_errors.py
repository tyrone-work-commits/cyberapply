from types import SimpleNamespace
import re
import pytest
from application_agent.submission_errors import PROCESSING_ERROR, submission_http_error, observed_processing_error
from application_agent.manual_submit import ManualSubmit


@pytest.mark.parametrize('status,url,method,expected',[
    (428,'https://boards.greenhouse.io/fixture/jobs/123?private=do-not-retain','POST',428),
    (500,'https://job-boards.greenhouse.io/fixture/jobs/123','POST',500),
    (200,'https://boards.greenhouse.io/fixture/jobs/123','POST',None),
    (428,'https://boards.greenhouse.io/fixture/jobs/123','GET',None),
    (428,'https://boards.greenhouse.io/uploads','POST',None),
    (428,'https://unapproved.example/fixture/jobs/123','POST',None),
])
def test_status_only_for_exact_page_authorized_submission(status,url,method,expected):
    page=object()
    response=SimpleNamespace(url=url,status=status,request=SimpleNamespace(method=method,frame=SimpleNamespace(page=page)))
    assert submission_http_error(response,{'boards.greenhouse.io','job-boards.greenhouse.io'},page)==expected
    assert submission_http_error(response,{'boards.greenhouse.io'},object()) is None


def test_error_detection_requires_visible_error_ui():
    text='There was an error processing your application. Please try again.'
    class Frame:
        def locator(self,selector):
            assert ':visible' in selector and 'body' not in selector
            return SimpleNamespace(count=lambda:1,nth=lambda _:SimpleNamespace(inner_text=lambda **_:text))
    assert observed_processing_error([Frame()])
    assert not PROCESSING_ERROR.search('Protected by reCAPTCHA')


def test_manual_error_waits_on_same_page_never_retries_and_later_accepts_confirmation(monkeypatch):
    from copy import deepcopy
    from itertools import count
    calls=[];listeners={};texts=['There was an error processing your application. Please try again.']
    clock=count(0,3);monkeypatch.setattr('application_agent.manual_submit.time.monotonic',lambda:next(clock))
    class Frame:
        url='https://boards.greenhouse.io/fixture/jobs/123'
        def evaluate(self,*_):return 1
        def locator(self,selector):
            if selector=='body':return SimpleNamespace(inner_text=lambda **_:texts[0])
            return SimpleNamespace(count=lambda:1,nth=lambda _:SimpleNamespace(inner_text=lambda **_:texts[0]))
    page=SimpleNamespace(url=Frame.url,frames=[Frame()],is_closed=lambda:False,wait_for_timeout=lambda _:None,on=lambda event,fn:listeners.update({event:fn}))
    context=SimpleNamespace(expose_binding=lambda *_:None,add_init_script=lambda *_:None)
    def api(path,body):
        calls.append(deepcopy(body))
        if len(calls)==1:
            listeners['response'](SimpleNamespace(url=Frame.url+'?private=secret',status=428,request=SimpleNamespace(method='POST',frame=SimpleNamespace(page=page))))
        if len(calls)>=3:texts[0]='Thank you for applying'
        return {'session':{'state':'confirmed' if body['event']=='confirmed' else 'needs_submit' if len(calls)>1 else 'ready','processingError':{'source':'browser'} if len(calls)>1 else None,'approvedHosts':[]}}
    actor=ManualSubmit(api,{'requestId':'fixture','claimId':'fixture-claim'},notify=None)
    actor.minimize=lambda *_:None
    actor.window=lambda *_:pytest.fail('No owner Open was requested')
    journey=SimpleNamespace(data={'version':1,'continue_click_attempts':0,'submit_click_attempts':0,'possible_delivery':True})
    report={'journey':journey.data}
    result=actor.wait(context,page,report,journey,{'boards.greenhouse.io'},re.compile('Thank you for applying'))
    assert result['status']=='applied' and actor.page is page
    assert [c['event'] for c in calls]==['ready','processing_error','poll','confirmed']
    assert calls[1]['submissionHttpStatus']==428
    assert 'private=secret' not in str(calls)
    assert journey.data['submit_click_attempts']==0 and journey.data['possible_delivery'] is True
