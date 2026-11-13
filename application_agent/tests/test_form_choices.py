from unittest.mock import Mock, patch

from application_agent.form_choices import capture_application_choices, choice_limit, refresh_missing_choices


def test_location_choices_keep_the_country_list_beyond_the_first_hundred():
    options=[f'Offered country {i}' for i in range(180)]+['United States']
    control=Mock()
    with patch('application_agent.form_choices.capture_combobox_options', return_value=options):
        choices,truncated=capture_application_choices(Mock(), control, {'label':'Country','type':'combobox'}, {'country':'USA'})
    assert choices[-1]=='United States' and len(choices)==181 and not truncated
    control.fill.assert_not_called()
    assert choice_limit('Location (City)*')==400 and choice_limit('Preferred shift?')==100


def test_search_only_city_uses_saved_city_and_only_reads_the_linked_choices():
    frame,control=Mock(),Mock();control.evaluate.return_value=True
    with patch('application_agent.form_choices.capture_combobox_options', side_effect=[[],['Dallas, Texas, United States']]) as capture:
        choices,truncated=capture_application_choices(frame,control,{'label':'Location (City)','type':'combobox'},{'city':'Dallas','country':'USA'})
    control.fill.assert_called_once_with('Dallas',timeout=1500)
    assert choices==['Dallas, Texas, United States'] and not truncated and capture.call_count==2
    control.press.assert_not_called();control.click.assert_not_called()


def test_missing_facts_other_questions_and_readonly_controls_are_never_searched():
    for field,profile,editable in [({'label':'Location (City)'},{},True),({'label':'Preferred salary?'},{'city':'Dallas'},True),({'label':'City'},{'city':'Dallas'},False),({'label':'City'},{'city':'Bad\nCity'},True)]:
        control=Mock();control.evaluate.return_value=editable
        with patch('application_agent.form_choices.capture_combobox_options',return_value=[]):
            assert capture_application_choices(Mock(),control,field,profile)==([],False)
        control.fill.assert_not_called()


def test_country_search_canonicalizes_only_the_saved_country_and_bounds_results():
    control=Mock();control.evaluate.return_value=True
    with patch('application_agent.form_choices.capture_combobox_options',side_effect=[[],['United States']]):
        assert capture_application_choices(Mock(),control,{'label':'Country'},{'country':'USA'})[0]==['United States']
    control.fill.assert_called_once_with('United States',timeout=1500)
    with patch('application_agent.form_choices.capture_combobox_options',return_value=['Offered']*401):
        choices,truncated=capture_application_choices(Mock(),Mock(),{'label':'Country'},{})
    assert len(choices)==400 and truncated


def test_lookup_failure_is_an_empty_catalog_without_selection_or_submission():
    control=Mock();control.evaluate.return_value=True;control.fill.side_effect=TimeoutError('fixture lookup failed')
    with patch('application_agent.form_choices.capture_combobox_options',return_value=[]):
        assert capture_application_choices(Mock(),control,{'label':'City'},{'city':'Dallas'})==([],False)
    control.press.assert_not_called();control.click.assert_not_called()


def test_late_capture_retries_and_updates_question_metadata_without_replaying_answers():
    frame,control=Mock(),Mock();control.count.return_value=1
    field={'id':'0:country','label':'Country','type':'combobox','phoneCountry':True,'options':[]}
    report={'questions':[{'question':'Country','field_type':'combobox','options':[]}], 'answers':[{'question':'Country','selected_option':'Nigeria +234'}]}
    with patch('application_agent.form_choices.capture_application_choices',side_effect=[([],False),(['Nigeria +234','United States +1'],False)]) as capture:
        refresh_missing_choices([frame],{'0:country':control},[field],report,{'country':'USA'})
    assert capture.call_count==2 and capture.call_args.args[3]=={}
    assert report['questions'][0]['options']==['Nigeria +234','United States +1']
    assert report['answers']==[{'question':'Country','selected_option':'Nigeria +234'}]
    control.fill.assert_not_called();control.press.assert_not_called();control.click.assert_not_called()


def test_late_capture_keeps_existing_choices_and_has_a_bounded_failure():
    frame,control=Mock(),Mock();control.count.return_value=1
    fields=[{'id':'0:known','label':'Known','type':'combobox','options':['Original']}, {'id':'0:missing','label':'Missing','type':'combobox','options':[]}]
    report={'questions':[{'question':'Known','field_type':'combobox','options':['Original']}]}
    with patch('application_agent.form_choices.capture_application_choices',return_value=([],False)) as capture:
        refresh_missing_choices([frame],{'0:known':control,'0:missing':control},fields,report,{})
    assert capture.call_count==2 and report['questions'][0]['options']==['Original']


def test_replaced_control_requires_unique_original_id_role_and_matching_label():
    for label in ['Country','Different question']:
        frame,old,candidate=Mock(),Mock(),Mock();old.count.return_value=0
        frame.locator.return_value=candidate;candidate.count.return_value=1;candidate.get_attribute.return_value='combobox';candidate.evaluate.return_value=label
        field={'id':'0:old','domId':'country','label':'Country','type':'combobox','options':[]};report={'questions':[{'question':'Country','field_type':'combobox','options':[]}]}
        with patch('application_agent.form_choices.capture_application_choices',return_value=(['Offered'],False)) as capture:
            refresh_missing_choices([frame],{'0:old':old},[field],report,{})
        assert capture.called==(label=='Country')
        assert bool(report['questions'][0]['options'])==(label=='Country')
