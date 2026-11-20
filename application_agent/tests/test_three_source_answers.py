"""The actual planner combines all saved sources without contacting an employer."""
import unittest

from application_agent.reasoning import build_plan
from application_agent.tests.test_answer_approvals import CV, field


class ThreeSourceAnswersTests(unittest.TestCase):
    def payload(self):
        return {
            'cv': {'text': CV},
            'job': {'id': 'fictional-role', 'title': 'SOC Analyst', 'description': 'Investigate SIEM alerts.'},
            'applicantProfile': {
                'fullName': 'Fictional Profile Name', 'city': 'Abuja',
                'expectedSalary': {'amount': 2000, 'currency': 'USD', 'period': 'month'},
                'employerQuestions': [{
                    'question': 'Which shift do you prefer?', 'fieldType': 'select',
                    'answer': 'Evening', 'source': 'user', 'reusePolicy': 'exact_question',
                }],
            },
        }

    def fields(self):
        return [field('First name'), field('Location (City)'), field('Email'),
                field('Expected yearly salary USD', 'number'),
                field('Do you have experience with Splunk?', 'select', options=['Yes', 'No']),
                field('Which shift do you prefer?', 'select', options=['Morning', 'Evening'])]

    def test_one_application_combines_cv_library_and_profile(self):
        result = build_plan(self.payload(), self.fields())
        self.assertFalse(result['unresolved'])
        answers = {a['field_id']: a for a in result['answers']}
        self.assertEqual(answers['First name']['value'], 'Fictional Profile Name')
        self.assertEqual(answers['Location (City)']['value'], 'Abuja')
        self.assertEqual(answers['Expected yearly salary USD']['value'], '24000')
        self.assertEqual(answers['Email']['value'], 'user@example.test')
        self.assertEqual(answers['Do you have experience with Splunk?']['value'], 'Yes')
        self.assertEqual(answers['Which shift do you prefer?']['value'], 'Evening')
        self.assertEqual({a['source'] for a in result['answers']}, {'cv', 'edit_profile', 'saved_profile'})

    def test_next_plan_reads_changed_sources_and_keeps_unknown_facts_unanswered(self):
        payload = self.payload()
        build_plan(payload, self.fields())
        payload['cv']['text'] = CV.replace('user@example.test', 'updated@example.test')
        payload['applicantProfile']['city'] = 'Lagos'
        payload['applicantProfile']['expectedSalary']['amount'] = 3000
        payload['applicantProfile']['employerQuestions'][0]['answer'] = 'Morning'
        result = build_plan(payload, self.fields() + [field('What is your date of birth?')])
        answers = {a['field_id']: a['value'] for a in result['answers']}
        self.assertEqual(answers['Email'], 'updated@example.test')
        self.assertEqual(answers['Location (City)'], 'Lagos')
        self.assertEqual(answers['Expected yearly salary USD'], '36000')
        self.assertEqual(answers['Which shift do you prefer?'], 'Morning')
        self.assertNotIn('What is your date of birth?', answers)
        self.assertEqual(result['unresolved'][0]['question'], 'What is your date of birth?')
