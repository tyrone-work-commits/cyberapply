import unittest
from application_agent.reasoning import build_plan
from application_agent.tests.test_answer_approvals import CV,field

class AnswerMemoryTests(unittest.TestCase):
 def payload(self,q,answer,kind='text',**extra):
  return {'cv':{'text':CV},'job':{'id':'one','title':'SOC Analyst','description':'Monitor alerts.'},'applicantProfile':{'employerQuestions':[{'question':q,'answer':answer,'source':'user','fieldType':kind,**extra}]}}
 def test_explicit_profile_fact_answers_the_same_question_without_approval(self):
  q='Have you worked with Kubernetes?';p=self.payload(q,'Yes','select');r=build_plan(p,[field(q,'select',options=['Yes','No'])]);self.assertEqual(r['answers'][0]['value'],'Yes');self.assertEqual(r['answers'][0]['source'],'saved_profile')
 def test_generated_memory_is_not_a_new_fact_and_job_specific_text_does_not_transfer(self):
  q='Have you worked with Kubernetes?';p=self.payload(q,'Yes','select');p['applicantProfile']['employerQuestions'][0]['source']='cv_and_job';self.assertFalse(build_plan(p,[field(q,'select',options=['Yes','No'])])['answers'])
  q='Tell us your motivation';p=self.payload(q,'I would work for Company One.','textarea',jobSpecific=True,jobId='other');p['applicantProfile']['employerQuestions'][0]['source']='cv_and_job';r=build_plan(p,[field(q,'textarea')]);self.assertTrue(all('Company One' not in a['value'] for a in r['answers']))
 def test_consent_remains_manual_but_explicit_eligibility_answers_are_reusable(self):
  q='I agree to these privacy terms';r=build_plan(self.payload(q,'Yes','checkbox'),[field(q,'checkbox')]);self.assertFalse(r['answers'])
  q='Are you authorized to work in USA?';r=build_plan(self.payload(q,'Yes','select'),[field(q,'select',options=['Yes','No'])]);self.assertEqual(r['answers'][0]['source'],'saved_profile');self.assertEqual(r['answers'][0]['value'],'Yes')
 def test_edited_short_profile_answer_overrides_only_the_exact_question(self):
  p=self.payload('City','Lagos');p['applicantProfile']['city']='Abuja'
  r=build_plan(p,[field('City'),field('Location (City)')]);answers={a['field_id']:a for a in r['answers']}
  self.assertEqual(answers['City']['value'],'Lagos');self.assertEqual(answers['City']['source'],'saved_profile');self.assertEqual(answers['Location (City)']['value'],'Abuja')
 def test_existing_salary_edits_work_for_a_different_employer(self):
  q='Expected yearly salary USD';p=self.payload(q,'90000','number',jobId='one',reusePolicy='job_only')
  self.assertEqual(build_plan(p,[field(q,'number')])['answers'][0]['value'],'90000')
  p['job']['id']='other';self.assertEqual(build_plan(p,[field(q,'number')])['answers'][0]['value'],'90000')
 def test_manual_reference_is_never_used_as_an_automatic_answer(self):
  q='Do you require sponsorship for this role?';p=self.payload(q,'No','select',reusePolicy='manual_only')
  self.assertFalse(build_plan(p,[field(q,'select',options=['Yes','No'])])['answers'])
 def test_case_insensitive_explicit_choice_matches_the_actual_dropdown(self):
  q='Are you authorized to work in USA?';r=build_plan(self.payload(q,'yes','select'),[field(q,'select',options=['Yes','No'])]);self.assertEqual(r['answers'][0]['value'],'Yes')
 def test_changed_choices_and_ambiguous_labels_do_not_inherit_old_answers(self):
  q='Have you worked with Kubernetes?';p=self.payload(q,'Yes','select');self.assertFalse(build_plan(p,[field(q,'select',options=['Experienced','New to this'])])['answers'])
  r=build_plan(p,[field(q,'select',options=['Yes','No']),field(q,'select',options=['Yes','No'])]);self.assertFalse(r['answers'])
 def test_human_automation_verification_is_not_a_reusable_fact(self):
  q='Which of the following best describes you?';choices=['I am an AI, bot, or automated program.','I am a human.']
  for kind in ['select','combobox']:
   p=self.payload(q,'I am a human.',kind);p['confirmedAnswers']=[{'question':q,'value':'I am a human.'}]
   r=build_plan(p,[field(q,kind,options=choices)]);self.assertFalse(r['answers']);self.assertEqual(r['unresolved'][0]['source'],'verification')
  p=self.payload(q,'I am a human.','combobox');r=build_plan(p,[field(q,'combobox')]);self.assertFalse(r['answers'])
 def test_ai_experience_question_is_not_misclassified_as_human_verification(self):
  from application_agent.answer_memory import automation_check
  self.assertFalse(automation_check('Have you worked with AI tools?',['Yes','No']))

 def test_answers_beyond_forty_use_the_latest_saved_answer_across_jobs(self):
  q='Expected yearly salary USD';p=self.payload(q,'90000','number',jobId='one',reusePolicy='job_only')
  row=p['applicantProfile']['employerQuestions'][0];row['updatedAt']='2026-11-02T10:00:00Z'
  p['applicantProfile']['employerQuestions']=[{**row,'question':f'Other question {i}'} for i in range(60)]+[{**row,'jobId':'two','answer':'80000','updatedAt':'2026-11-02T09:00:00Z'},row]
  self.assertEqual(build_plan(p,[field(q,'number')])['answers'][0]['value'],'90000')

 def test_same_question_in_other_control_does_not_hide_a_compatible_saved_answer(self):
  q='Have you worked with Kubernetes?';p=self.payload(q,'Yes','select')
  p['applicantProfile']['employerQuestions'].append({'question':q,'answer':'Different text answer','source':'user','fieldType':'textarea'})
  self.assertEqual(build_plan(p,[field(q,'select',options=['Yes','No'])])['answers'][0]['value'],'Yes')

 def test_saved_explanatory_answer_is_reusable_for_the_same_question_elsewhere(self):
  q='Why this role?';p=self.payload(q,'I enjoy investigating security alerts.','textarea',jobSpecific=True,jobId='earlier-employer',reusePolicy='job_only')
  result=build_plan(p,[field(q,'text')]);self.assertEqual(result['answers'][0]['value'],'I enjoy investigating security alerts.')
 def test_latest_clear_or_conflicting_equal_date_does_not_resurrect_an_old_answer(self):
  from application_agent.answer_memory import remembered_answer
  p=self.payload('City','Lagos',updatedAt='2026-11-02T09:00:00Z');p['applicantProfile']['employerQuestions'].append({'question':'City','answer':'','source':'user','fieldType':'text','updatedAt':'2026-11-02T10:00:00Z'})
  self.assertIsNone(remembered_answer(p,'City',field('City')))
  p['applicantProfile']['employerQuestions'][1].update(answer='Abuja',updatedAt='2026-11-02T09:00:00Z');self.assertIsNone(remembered_answer(p,'City',field('City')))
 def test_dropdown_answers_transfer_between_compatible_widgets_but_not_changed_choices(self):
  q='Have you worked with Kubernetes?';p=self.payload(q,'Yes','radio',jobId='other',jobSpecific=True)
  r=build_plan(p,[field(q+'*','select',options=['Yes','No'])]);self.assertEqual(r['answers'][0]['value'],'Yes')
  self.assertFalse(build_plan(p,[field(q,'select',options=['Expert','Beginner'])])['answers'])
