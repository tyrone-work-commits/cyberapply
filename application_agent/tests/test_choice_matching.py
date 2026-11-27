"""Matching uses saved facts; browser fixtures intercept every request."""
import pytest

from application_agent.choice_matching import unique_option
from application_agent.reasoning import build_plan
from application_agent.tests.test_browser import FORM, PAYLOAD, run
from application_agent.tests.test_combobox import dropdowns

PROFILE = {'city': 'Dallas', 'state': 'Texas', 'country': 'USA', 'usaRightToWork': True}
CV = 'Alex\nalex@example.com\nExperience\nSOC Analyst | Jan 2023 - Dec 2024\nInvestigated Splunk alerts.\nhttps://linkedin.com/in/alex'


def payload(profile=PROFILE, cv=CV):
    return {**PAYLOAD, 'applicantProfile': profile, 'cv': {**PAYLOAD['cv'], 'text': cv}}


def test_unique_matching_does_not_fuzz_or_take_first():
    assert unique_option('Country', 'USA', ['United States', 'United Kingdom'], PROFILE) == 'United States'
    assert unique_option('State', 'Texas', ['TX', 'CA'], PROFILE) == 'TX'
    assert unique_option('State', 'CA', ['California', 'Ontario'], {'country': 'Canada'}) is None
    assert unique_option('City', 'Dallas', ['Dallas, TX, United States', 'Dallas, OR, United States'], PROFILE) == 'Dallas, TX, United States'
    assert unique_option('City', 'Dallas', ['Dallas, TX, United States', 'Dallas, OR, United States'], {'country': 'USA'}) is None
    assert unique_option('Country', 'USA', ['USA', 'United States'], PROFILE) is None
    assert unique_option('Country', 'USA', ['USA', 'USA'], PROFILE) is None
    assert unique_option('Country', 'USA', ['USA citizen', 'Canada'], PROFILE) is None
    assert unique_option('Eligibility', 'Yes', ['No', 'Yes.'], PROFILE) == 'Yes.'
    assert unique_option('Eligibility', 'Yes', ['Yes, with sponsorship', 'No'], PROFILE) is None


def test_cv_year_bucket_requires_exact_duration_and_one_unambiguous_range():
    question = {'id': 'years', 'label': 'Years of cybersecurity experience', 'type': 'select', 'required': True,
                'options': ['Less than 1 year', '1-2 years', '3-5 years', '5+ years']}
    result = build_plan(payload(), [question])
    assert result['answers'][0]['value'] == '1-2 years'
    assert result['answers'][0]['source'] == 'cv'
    assert 'SOC Analyst' in result['answers'][0]['evidence']
    assert not build_plan(payload(), [{**question, 'options': ['1-2 years', '2-3 years']}])['answers']
    assert not build_plan(payload(cv=CV.replace('Jan 2023 - Dec 2024', '2021 - 2024')), [question])['answers']
    assert not build_plan(payload(cv='Alex\nSkills: Splunk'), [question])['answers']
    assert unique_option('Years', '2', ['2+ years'], PROFILE) is None


@pytest.mark.parametrize('custom', [False, True])
def test_profile_choices_and_cv_experience_reach_native_and_custom_controls(custom):
    definitions = [
        {'label': 'Location (City)', 'options': ['Dallas, TX, United States', 'Dallas, OR, United States']},
        {'label': 'State', 'options': ['TX', 'CA']},
        {'label': 'Country', 'options': ['United States', 'United Kingdom']},
        {'label': 'Years of cybersecurity experience', 'options': ['Less than 1 year', '1-2 years', '3-5 years']},
        {'label': 'Do you have experience with Splunk?', 'options': ['No', 'Yes.']},
    ]
    html = dropdowns(definitions) if custom else FORM.replace('{extra}', ''.join(
        f'<label>{d["label"]}<select required><option value="">Choose</option>' +
        ''.join(f'<option>{o}</option>' for o in d['options']) + '</select></label>' for d in definitions))
    result, posts = run(html, payload=payload(), planner=build_plan, submit=False)
    assert not posts and not result['report']['unresolved'], result
    values = {row['question']: row.get('selected_option', row['value']) for row in result['report']['answers']}
    assert [values[d['label']] for d in definitions] == ['Dallas, TX, United States', 'TX', 'United States', '1-2 years', 'Yes.']
    assert 'Dry run' in result['message']


def test_cv_link_dropdown_is_verified_from_chosen_cv():
    result, posts = run(dropdowns([{'label': 'LinkedIn', 'options': ['https://linkedin.com/in/other', 'https://linkedin.com/in/alex']}]),
                        payload=payload(), planner=build_plan, submit=False)
    assert not posts and not result['report']['unresolved'], result
    assert result['report']['answers'][-1]['selected_option'] == 'https://linkedin.com/in/alex'


@pytest.mark.parametrize('extra', [
    '<label>Country<select required><option disabled>United States</option><option>Canada</option></select></label>',
    '<label>Country<select required><option>United States</option><option>United States</option></select></label>',
])
def test_disabled_or_duplicate_native_choice_pauses_without_submission(extra):
    result, posts = run(FORM.replace('{extra}', extra), payload=payload(), planner=build_plan, submit=False)
    assert not posts and result['report']['unresolved'], result


def test_verification_and_unknown_experience_still_pause():
    definitions = [
        {'label': 'Which of the following best describes you?', 'options': ['I am a human.', 'I am an AI, bot, or automated program.']},
        {'label': 'Do you have experience with Kubernetes?', 'options': ['Yes', 'No']},
    ]
    result, posts = run(dropdowns(definitions), payload=payload(), planner=build_plan, submit=False)
    assert not posts and len(result['report']['unresolved']) == 2, result
    assert not any('selected_option' in a for a in result['report']['answers'])


def test_native_dropdown_rejecting_selection_does_not_claim_success():
    html = FORM.replace('{extra}', '''<label>Country<select required id="reject-country">
        <option>Canada</option><option>United States</option></select></label>
        <script>document.getElementById('reject-country').addEventListener('change', e=>{e.target.selectedIndex=0;});</script>''')
    result, posts = run(html, payload=payload(), planner=build_plan, submit=False)
    assert not posts and result['status'] == 'needs_attention', result
    assert not any(a['question'] == 'Country' for a in result['report']['answers'])
    assert 'repair' in result['message'].lower()
