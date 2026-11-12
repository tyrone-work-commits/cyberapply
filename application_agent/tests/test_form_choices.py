from unittest.mock import Mock, patch

from application_agent.form_choices import capture_application_choices, choice_limit


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
