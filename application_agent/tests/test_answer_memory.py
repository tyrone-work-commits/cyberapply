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
  q='Tell us your motivation';p=self.payload(q,'I would work for Company One.','textarea',jobSpecific=True,jobId='other');r=build_plan(p,[field(q,'textarea')]);self.assertTrue(all('Company One' not in a['value'] for a in r['answers']))
 def test_consent_and_work_permission_cannot_be_learned_from_generic_memory(self):
  for q,kind in [('I agree to these privacy terms','checkbox'),('Are you authorized to work in USA?','select')]:
   r=build_plan(self.payload(q,'Yes',kind),[field(q,kind,options=['Yes','No'])]);self.assertFalse(r['answers'])
 def test_changed_choices_and_ambiguous_labels_do_not_inherit_old_answers(self):
  q='Have you worked with Kubernetes?';p=self.payload(q,'Yes','select');self.assertFalse(build_plan(p,[field(q,'select',options=['Experienced','New to this'])])['answers'])
  r=build_plan(p,[field(q,'select',options=['Yes','No']),field(q,'select',options=['Yes','No'])]);self.assertFalse(r['answers'])
