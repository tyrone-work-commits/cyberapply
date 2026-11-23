"""Ten isolated browser forms. All employer requests are intercepted fixtures."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading
import hashlib
from application_agent.browser import execute_application
from application_agent.manual_submit import ManualSubmit
from application_agent.tests.test_browser import FORM,dns,browser_factory


def test_ten_forms_fill_independently_while_one_manual_submit_cannot_release_others():
 barrier=threading.Barrier(11);release=[threading.Event() for _ in range(10)];posts=[[] for _ in range(10)];pages=[];lock=threading.Lock()
 def run(index):
  cv=('Fictional chosen CV '+str(index)).encode();email=f'person-{index}@example.test'
  payload={'requestId':f'request-{index}','job':{'url':f'https://job-boards.greenhouse.io/fixture/jobs/{100+index}','company':'Fictional employer','title':'Fictional Security Analyst'},'cv':{'name':f'chosen-{index}.pdf','type':'application/pdf','sha256':hashlib.sha256(cv).hexdigest(),'text':email}}
  def planner(_payload,fields,_research):return {'answers':[{'field_id':f['id'],'value':email,'source':'cv','evidence':email} for f in fields if f['label']=='Email'],'unresolved':[],'cover_letter':'','experience':{}}
  @contextmanager
  def factory():
   with browser_factory(FORM.replace('{extra}',''),posts[index]) as runtime:
    launch=runtime.chromium.launch
    runtime.chromium.launch=lambda **kw:launch(**{**kw,'headless':True})
    yield runtime
  class Human(ManualSubmit):
   def minimize(self,context,page):self.page=page
   def window(self,context,page):
    assert release[index].is_set()
    assert page.locator('input[type=email]').input_value()==email
    page.get_by_role('button',name='Submit application').click()
   def api(self,path,body):
    assert body['requestId']==f'request-{index}'
    if body['event']=='ready':
     assert self.page.locator('input[type=email]').input_value()==email
     assert self.page.locator('input[type=file]').evaluate('e=>e.files[0].name')==f'chosen-{index}.pdf'
     with lock:pages.append(id(self.page))
     try:barrier.wait(timeout=120)
     except threading.BrokenBarrierError:return {'session':{**body,'state':'cancel_requested'}}
    session={**body,'state':'confirmed' if body['event']=='confirmed' else 'ready','openRequested':False}
    if release[index].is_set() and not posts[index]:session['openRequested']=True
    return {'session':session}
  actor=Human(None,{'requestId':f'request-{index}','claimId':f'claim-{index}'},notify=None);actor.call=actor.api
  result=execute_application(payload,cv,submit=True,planner=planner,research_fn=lambda _: {},resolver=dns,timeout=3000,before_submit=lambda:True,playwright_factory=factory,manual_submit_handler=actor)
  assert result['status']=='applied',result
  assert result['report']['journey']['submit_click_attempts']==0
  assert len(posts[index])==1 and cv in posts[index][0] and email.encode() in posts[index][0]
  return result
 def guarded(index):
  try:return run(index)
  except Exception:barrier.abort();raise
 with ThreadPoolExecutor(max_workers=10) as pool:
  futures=[pool.submit(guarded,i) for i in range(10)]
  try:
   barrier.wait(timeout=120)
   assert len(set(pages))==10 and all(not rows for rows in posts)
   release[0].set();futures[0].result(timeout=60)
   assert all(not posts[i] for i in range(1,10))
  finally:
   for event in release:event.set()
  for future in futures:future.result(timeout=90)
