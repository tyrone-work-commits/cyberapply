from application_agent.tests.test_browser import FORM,run


def test_delayed_receipt_is_observed_without_another_submission():
    html=FORM.replace('{extra}',"""<script>document.querySelector('form').onsubmit=event=>{
      event.preventDefault();fetch('/submit',{method:'POST',body:new FormData(event.target)}).then(()=>{
        setTimeout(()=>document.body.textContent='Your application has been successfully received',1800);
      });};</script>""")
    def employer(req):return 'Accepted' if req.method=='POST' else html
    result,posts=run(employer)
    assert result['status']=='applied' and len(posts)==1,result


def test_missing_receipt_remains_uncertain_and_submit_is_not_replayed():
    result,posts=run(FORM.replace('{extra}',''),success=False)
    assert result['status']=='uncertain' and len(posts)==1,result
