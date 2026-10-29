import unittest
from application_agent.reasoning import build_plan

CV='Test Candidate\nuser@example.test\nEXPERIENCE\nSOC Analyst | Jan 2023 - Dec 2024\nInvestigated SIEM alerts with Splunk.\nBuilt Python monitoring tools.'
def field(q,kind='text',**kw):return {'id':q,'label':q,'type':kind,'required':True,**kw}
def plan(fields,**kw):return build_plan({'cv':{'text':CV},'job':{'title':'SOC Analyst','company':'Example','description':'Monitor SIEM alerts.'},**kw},fields)

class ApprovalTests(unittest.TestCase):
 def test_yes_comes_from_actual_cv_experience_only(self):
  result=plan([field('Do you have experience with Splunk?','select',options=['Yes','No'])])
  self.assertEqual(result['answers'][0]['value'],'Yes');self.assertEqual(result['answers'][0]['source'],'cv')
  for q in ['Do you have experience with Kubernetes?','Do you have experience with Splunk and Kubernetes?']:
   self.assertFalse(plan([field(q,'select',options=['Yes','No'])])['answers'])
 def test_generated_explanation_waits_for_approval(self):
  question='Do you have experience with Splunk?'
  result=plan([field(question)])
  self.assertFalse(result['answers']);draft=result['unresolved'][0]
  self.assertEqual(draft['source'],'generated');self.assertIn('Yes.',draft['suggested_value']);self.assertIn('Splunk',draft['evidence'])
  approved=plan([field(question)],confirmedAnswers=[{'question':question,'value':draft['suggested_value']}])
  self.assertEqual(approved['answers'][0]['source'],'user_confirmed')
 def test_generated_optional_answer_also_waits_for_review(self):
  result=plan([field('Why are you interested in this role?','textarea',required=False)])
  self.assertFalse(result['answers']);self.assertEqual(result['unresolved'][0]['source'],'generated')
 def test_unknown_personal_facts_and_unsupported_experience_are_not_fabricated(self):
  result=plan([field('What is your date of birth?'),field('Describe your experience with Kubernetes')])
  self.assertFalse(result['answers']);self.assertTrue(all('suggested_value' not in x for x in result['unresolved']))
 def test_cover_letter_file_requires_exact_approved_text(self):
  q='Cover letter'
  pending=plan([field(q,'file')]);self.assertFalse(pending['answers']);self.assertEqual(pending['unresolved'][0]['source'],'generated')
  approved=plan([field(q,'file')],confirmedAnswers=[{'question':q,'value':'My personally reviewed and edited cover letter.'}])
  self.assertEqual(approved['answers'][0]['value'],'My personally reviewed and edited cover letter.')
 def test_visa_and_right_to_work_use_different_saved_answers(self):
  profile={'ukVisaRequired':True,'ukRightToWork':False,'usaVisaRequired':False,'usaRightToWork':True,'canadaVisaRequired':True,'canadaRightToWork':None}
  fields=[field('Do you need a visa in the UK?','select',options=['Yes','No']),field('Are you authorized to work in the UK?','radio',options=['Yes','No']),field('Do you require sponsorship in USA?'),field('Do you have the right to work in the United States?'),field('Do you need a work visa for Canada?'),field('Do you have the right to work in Canada?')]
  result=plan(fields,applicantProfile=profile,confirmedAnswers=[{'question':fields[0]['label'],'value':'No'}])
  self.assertEqual([x['value'] for x in result['answers']],['Yes','No','No','Yes','Yes'])
  self.assertTrue(all(x['source']=='edit_profile' for x in result['answers']));self.assertEqual(len(result['unresolved']),1)
 def test_false_visa_does_not_imply_work_authorization(self):
  result=plan([field('Are you authorized to work in USA?')],applicantProfile={'usaVisaRequired':False})
  self.assertFalse(result['answers']);self.assertIn('Edit Profile',result['unresolved'][0]['reason'])
 def test_ambiguous_combined_or_negative_eligibility_pauses(self):
  for q in ['Do you have the right to work in UK and Canada?','Can you work in UK without visa sponsorship?']:
   self.assertFalse(plan([field(q)],applicantProfile={'ukVisaRequired':False,'ukRightToWork':True})['answers'])

if __name__=='__main__':unittest.main()
