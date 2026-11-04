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
 def test_generated_explanation_uses_cv_evidence_without_separate_approval(self):
  question='Do you have experience with Splunk?'
  result=plan([field(question)])
  self.assertFalse(result['unresolved']);answer=result['answers'][0]
  self.assertTrue(answer['automatic']);self.assertIn('Splunk',answer['evidence'])
  self.assertIn('Yes.',answer['value'])
 def test_generated_optional_answer_is_automatic(self):
  result=plan([field('Why are you interested in this role?','textarea',required=False)])
  self.assertFalse(result['unresolved']);self.assertTrue(result['answers'][0]['automatic'])
 def test_unknown_personal_facts_and_unsupported_experience_are_not_fabricated(self):
  result=plan([field('What is your date of birth?'),field('Describe your experience with Kubernetes')])
  self.assertFalse(result['answers']);self.assertTrue(all('suggested_value' not in x for x in result['unresolved']))
 def test_cover_letter_file_is_automatic_but_explicit_user_text_still_wins(self):
  q='Cover letter'
  automatic=plan([field(q,'file')]);self.assertFalse(automatic['unresolved']);self.assertTrue(automatic['answers'][0]['automatic'])
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
  for q in ['Do you have the right to work in UK and Canada?','Can you work in UK without visa sponsorship?','Do you have a valid work visa for UK?','What is your UK visa expiry date?']:
   self.assertFalse(plan([field(q)],applicantProfile={'ukVisaRequired':False,'ukRightToWork':True})['answers'])

class OpenEndedTests(unittest.TestCase):
 def test_new_open_ended_wording_is_drafted_automatically_from_cv(self):
  for question in ['What interests you most about this opportunity?','What are your professional strengths?','Is there anything else you would like us to know?']:
   result=plan([field(question,'textarea')]);self.assertFalse(result['unresolved']);self.assertTrue(result['answers'][0]['automatic']);self.assertIn('Splunk',result['answers'][0]['value'])
 def test_no_ai_wording_does_not_block_a_grounded_generated_answer(self):
  q='Why are you interested in this role at Chainguard? (While we love AI please do not use AI/ ChatGPT for any part of your application)'
  result=plan([field(q,'textarea')]);self.assertTrue(result['answers'][0]['automatic']);self.assertTrue(result['ai_drafting_allowed']);self.assertTrue(result['cover_letter']);self.assertFalse(result['unresolved'])
 def test_job_description_no_ai_wording_does_not_block_prose_or_cover_letters(self):
  fields=[field('Why this role?','textarea'),field('Cover letter','file')]
  result=plan(fields,job={'title':'SOC Analyst','company':'Example','description':'Please do not use ChatGPT for this application.'})
  self.assertEqual(len(result['answers']),2);self.assertTrue(all(row['automatic'] for row in result['answers']))
 def test_no_ai_policy_does_not_replace_an_applicants_own_supplied_text(self):
  q='Why this role? Please do not use AI for your answer.'
  result=plan([field(q,'textarea')],confirmedAnswers=[{'question':q,'value':'My own personally written answer for this employer.'}])
  self.assertEqual(result['answers'][0]['value'],'My own personally written answer for this employer.')
 def test_a_saved_draft_remains_usable_when_the_employer_mentions_no_ai(self):
  q='Why this role?';profile={'employerQuestions':[{'question':q,'answer':'An earlier generated draft','source':'user','fieldType':'textarea','aiDraft':True}]}
  result=plan([field(q,'textarea')],job={'title':'SOC Analyst','description':'Do not use AI for any answers.'},applicantProfile=profile)
  self.assertEqual(result['answers'][0]['value'],'An earlier generated draft');self.assertEqual(result['answers'][0]['source'],'saved_profile')
 def test_personal_unknowns_and_referral_facts_remain_uninvented(self):
  for q in ['How did you hear about us?','What is your favourite hobby?','What is your date of birth?']:
   self.assertFalse(plan([field(q,'textarea')])['answers'])

class InsufficientProseEvidenceTests(unittest.TestCase):
 def test_professional_interest_is_not_generated_from_contact_details_alone(self):
  result=build_plan({'cv':{'text':'Alex alex@example.test'},'job':{'title':'SOC Analyst'}},[field('Why this role?','textarea')]);self.assertFalse(result['answers'])

class CommonProsePromptsTests(unittest.TestCase):
 def test_summary_and_experience_explanations_use_actual_cv_evidence(self):
  for q in ['Professional summary','Relevant experience','Do you have experience with Splunk? Please explain.']:
   result=plan([field(q,'textarea')]);self.assertFalse(result['unresolved']);self.assertIn('Splunk',result['answers'][0]['value'])
 def test_no_ai_wording_across_line_breaks_does_not_disable_drafting(self):
  result=plan([field('Why this role? Please do not use\nAI or ChatGPT.','textarea')]);self.assertTrue(result['answers'][0]['automatic']);self.assertTrue(result['ai_drafting_allowed'])

class OptionalRestrictedProseTests(unittest.TestCase):
 def test_optional_no_ai_wording_also_receives_a_grounded_draft(self):
  result=plan([field('Anything else? Please do not use AI for your response.','textarea',required=False)])
  self.assertTrue(result['answers'][0]['automatic']);self.assertFalse(result['unresolved']);self.assertTrue(result['ai_drafting_allowed'])

class AuthorshipDeclarationTests(unittest.TestCase):
 def test_authorship_certifications_cannot_be_generated_or_falsely_reused(self):
  for q in ['I certify these answers were written without AI','Did you use AI for this application?','Are your answers AI generated?']:
   result=plan([field(q,'select',options=['Yes','No'])],applicantProfile={'employerQuestions':[{'question':q,'answer':'No','source':'user','fieldType':'select'}]})
   self.assertFalse(result['answers']);self.assertEqual(result['unresolved'][0]['source'],'authorship')

if __name__=='__main__':unittest.main()

class ReviewedLetterTests(unittest.TestCase):
 def test_explicit_attached_letter_is_used_for_text_and_file(self):
  text='My reviewed cover letter for this exact application.'
  for kind in ('file','textarea'):
   result=plan([field('Cover letter',kind)],coverLetter={'text':text})
   self.assertEqual(result['cover_letter'],text)
   self.assertEqual(result['answers'][0]['value'],text)
   self.assertEqual(result['answers'][0]['source'],'user_confirmed')
