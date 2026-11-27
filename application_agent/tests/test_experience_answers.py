"""No employer access: experience questions use user answers, not profile totals."""
import unittest
from application_agent.experience_answers import experience_duration_question
from application_agent.reasoning import build_plan


class ExperienceAnswersTests(unittest.TestCase):
    def payload(self):
        return {'cv': {'text': 'Fictional Candidate\nExperience\nSOC Analyst | Jan 2020 - Dec 2024\nInvestigated SIEM alerts.'},
                'job': {'id': 'fictional-job', 'title': 'SOC Analyst', 'description': 'Investigate security alerts.'},
                'applicantProfile': {'yearsExperience': 99}}

    def test_unanswered_duration_is_manual_even_with_profile_and_dated_cv(self):
        for question,kind,extra in [('Years of experience','number',{}),
                                    ('How many months of professional experience do you have?','text',{}),
                                    ('Do you have three years of security experience?','select',{'options':['Yes','No']})]:
            with self.subTest(question=question):
                result=build_plan(self.payload(),[{'id':'duration','label':question,'type':kind,'required':True,**extra}])
                self.assertEqual(result['answers'],[])
                self.assertEqual(result['unresolved'][0]['source'],'user_input')

    def test_saved_answer_and_exact_application_confirmation_are_reusable(self):
        question='Years of cybersecurity experience'
        field={'id':'duration','label':question,'type':'number','required':True}
        payload=self.payload()
        payload['applicantProfile']['employerQuestions']=[{'question':question,'fieldType':'number','answer':'3','source':'user','reusePolicy':'exact_question'}]
        self.assertEqual(build_plan(payload,[field])['answers'][0]['value'],'3')
        payload['confirmedAnswers']=[{'question':question,'value':'4'}]
        self.assertEqual(build_plan(payload,[field])['answers'][0]['value'],'4')

    def test_optional_duration_is_still_available_for_user_input(self):
        result=build_plan(self.payload(),[{'id':'duration','label':'Years of work experience','type':'number','required':False}])
        self.assertEqual(result['unresolved'][0]['question'],'Years of work experience')

    def test_experience_prose_and_graduation_year_are_not_duration_questions(self):
        self.assertFalse(experience_duration_question('Describe your experience with Linux'))
        self.assertFalse(experience_duration_question('What year did you graduate?'))
