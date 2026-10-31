from application_agent.tests.test_browser import FORM,run


def test_page_apply_call_to_action_does_not_compete_with_application_submit():
    html=FORM.replace('<body>','<body><button type="button" onclick="document.querySelector(\'form\').scrollIntoView()">Apply</button>').replace('{extra}','')
    result,posts=run(html)
    assert result['status']=='applied' and len(posts)==1,result
    assert result['report']['submission_control']['association']=='prepared_application_form'


def test_unrelated_form_apply_button_is_not_the_application_submit():
    html=FORM.replace('<body>','<body><form id="other"><button>Apply</button></form>').replace('{extra}','')
    result,posts=run(html)
    assert result['status']=='applied' and len(posts)==1,result


def test_two_submission_buttons_inside_the_prepared_form_still_pause():
    result,posts=run(FORM.replace('{extra}','<button type="button">Apply</button>'))
    assert result['status']=='needs_attention' and not posts,result
    assert result['report']['submission_control']['candidate_count']==2


def test_explicit_form_attribute_can_associate_an_external_submit_button():
    html=FORM.replace('<form action','<form id="application" action').replace('{extra}','').replace('<button type="submit">Submit application</button>','')
    html=html.replace('</form>','</form><button form="application" type="submit">Submit application</button><button type="button">Apply</button>')
    result,posts=run(html)
    assert result['status']=='applied' and len(posts)==1,result


def test_multiple_prepared_forms_are_not_silently_disambiguated():
    html=FORM.replace('{extra}','').replace('</body>','<form><label>Email<input name="otherEmail" type="email" required></label><button>Apply</button></form></body>')
    result,posts=run(html)
    assert result['status']=='needs_attention' and not posts,result


def test_dry_run_prefers_associated_next_over_introductory_apply():
    html=FORM.replace('<body>','<body><button type="button">Apply</button>').replace('{extra}','').replace('Submit application','Continue')
    result,posts=run(html,submit=False)
    assert result['status']=='needs_attention' and not posts and 'Advancing could send data' in result['message'],result
