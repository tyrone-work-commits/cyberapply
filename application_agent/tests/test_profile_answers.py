import unittest
from application_agent.reasoning import build_plan
from application_agent.research import fetch_research

PROFILE={'fullName':'Account Complete Name','zipCode':'00100','location':'Abuja, Nigeria','address':'10 Example Street','city':'Abuja','country':'Nigeria','phone':'+2348012345678','expectedSalary':{'amount':2000,'currency':'USD','period':'month'}}
CV='Test Candidate\ntest@example.test\nLocation: Wrong CV City\n+447700900123\nExperience\nSOC Analyst | Jan 2023 - Dec 2024\nInvestigated SIEM alerts.'
def field(label,kind='text',**kw):return {'id':label,'label':label,'type':kind,'required':True,**kw}
def plan(fields,profile=PROFILE,**kw):return build_plan({'cv':{'text':CV},'applicantProfile':profile,**kw},fields,{'salary_evidence':[{'low':90000,'high':100000,'currency':'USD','period':'year'}]})

class ProfileAnswerTests(unittest.TestCase):
 def test_first_last_and_full_name_all_use_complete_saved_name(self):
  labels=['Full name','First name','Last name','Given name','Family name','Surname','Preferred First Name','Please enter your first name','Applicant full name','First_name','LastName']
  result=plan([field(label) for label in labels],confirmedAnswers=[{'question':'First name','value':'Old split name'}])
  self.assertFalse(result['unresolved']);self.assertEqual(len(result['answers']),len(labels))
  self.assertTrue(all(a['value']=='Account Complete Name' and a['source']=='edit_profile' for a in result['answers']))
 def test_missing_profile_name_never_uses_cv_name(self):
  result=plan([field('First name'),field('Last name')],{})
  self.assertFalse(result['answers']);self.assertTrue(all(q['profile_field']=='fullName' for q in result['unresolved']))
 def test_city_parenthetical_uses_saved_city(self):
  self.assertEqual(plan([field('Location (City)')])['answers'][0]['value'],'Abuja')
 def test_country_aliases_choose_only_equivalent_offered_country(self):
  result=plan([field('Country','select',options=['United Kingdom','United States of America'])],PROFILE|{'country':'USA'})
  self.assertEqual(result['answers'][0]['value'],'United States of America')
 def test_residence_questions_answer_from_saved_country_and_city(self):
  labels={'Are you located in the United Kingdom or Ireland?':'No','Are you currently based in Nigeria?':'Yes','Do you live in Abuja?':'Yes','Are you located in Lagos?':'No'}
  for label,value in labels.items():
   with self.subTest(label=label):
    result=plan([field(label,'select',options=['Yes','No'])]);self.assertEqual(result['answers'][0]['value'],value);self.assertEqual(result['answers'][0]['source'],'edit_profile')
  uk=PROFILE|{'country':'UK','city':'London','location':'London, United Kingdom'}
  self.assertEqual(plan([field('Are you located in the United Kingdom or Ireland?','radio',options=['Yes','No'])],uk)['answers'][0]['value'],'Yes')
  self.assertEqual(plan([field('Are you located in UK/Ireland?')],uk)['answers'][0]['value'],'Yes')
 def test_residence_does_not_guess_missing_conflicting_conditional_or_narrower_regions(self):
  for profile,label in [({},'Are you based in the UK?'),(PROFILE|{'country':'UK'},'Are you based in Nigeria?'),(PROFILE,'Are you based within commuting distance of Abuja?'),(PROFILE|{'country':'UK','location':'UK','city':'London'},'Are you located in Scotland?')]:
   with self.subTest(label=label):self.assertFalse(plan([field(label)],profile)['answers'])
  self.assertFalse(plan([field('Are you located in the UK?')],{'city':'London'})['answers'])
  california=PROFILE|{'country':'USA','city':'Los Angeles','location':'Los Angeles, CA'}
  self.assertEqual(plan([field('Are you located in Canada?')],california)['answers'][0]['value'],'No')
  self.assertFalse(plan([field('Are you located in CA?')],california)['answers'])
 def test_country_specific_work_authorization_uses_its_own_saved_choice(self):
  p=PROFILE|{'ukRightToWork':False,'usaRightToWork':True,'canadaRightToWork':False}
  labels={'Are you authorized to work in the United Kingdom?':'No','Are you authorized to work in the United States?':'Yes','Do you have the right to work in Canada?':'No'}
  for label,value in labels.items():
   result=plan([field(label,'select',options=['Yes','No'])],p);self.assertEqual(result['answers'][0]['value'],value)
  self.assertFalse(plan([field('Are you authorized to work in Ireland?')],p)['answers'])
 def test_linkedin_always_uses_chosen_cv_and_never_old_confirmed_answer(self):
  cv=CV+'\nLinkedIn: www.linkedin.com/in/chosen-candidate\n'
  labels=['LinkedIn','LinkedIn URL','Please provide LinkedIn profile','Your LinkedIn profile link']
  for label in labels:
   result=build_plan({'cv':{'text':cv},'applicantProfile':PROFILE,'confirmedAnswers':[{'question':label,'value':'https://linkedin.com/in/old'}]},[field(label)])
   self.assertEqual(result['answers'][0]['value'],'https://www.linkedin.com/in/chosen-candidate');self.assertEqual(result['answers'][0]['source'],'cv')
  for text in [CV,CV+'\nhttps://linkedin.com.evil.example/in/wrong',CV+'\nhttps://linkedin.com/company/employer']:
   result=build_plan({'cv':{'text':text},'confirmedAnswers':[{'question':'LinkedIn','value':'https://linkedin.com/in/old'}]},[field('LinkedIn')]);self.assertFalse(result['answers']);self.assertIn('chosen CV',result['unresolved'][0]['reason'])
 def test_ireland_work_rights_and_visa_use_separate_saved_choices(self):
  p=PROFILE|{'irelandRightToWork':True,'irelandVisaRequired':False,'ukRightToWork':False}
  result=plan([field('Are you authorized to work in Ireland?','select',options=['Yes','No']),field('Do you require a work visa for Ireland?','select',options=['Yes','No'])],p)
  self.assertEqual([a['value'] for a in result['answers']],['Yes','No'])
  self.assertTrue(all(a['source']=='edit_profile' for a in result['answers']))
  result=plan([field('Are you authorized to work in Ireland?')],PROFILE|{'irelandVisaRequired':False},confirmedAnswers=[{'question':'Are you authorized to work in Ireland?','value':'Yes'}])
  self.assertFalse(result['answers']);self.assertEqual(result['unresolved'][0]['profile_field'],'irelandRightToWork')
 def test_uk_or_ireland_authorization_requires_sufficient_saved_choices(self):
  questions=['Are you authorized to work in the United Kingdom or Ireland for any employer?','Do you have the right to work in Ireland or the UK?']
  cases=[(False,False,'No'),(False,True,'Yes'),(True,False,'Yes'),(True,None,'Yes'),(None,True,'Yes'),(False,None,None),(None,False,None),(None,None,None)]
  for q in questions:
   for uk,ireland,expected in cases:
    with self.subTest(question=q,uk=uk,ireland=ireland):
     result=plan([field(q,'radio',options=['Yes','No'])],PROFILE|{'ukRightToWork':uk,'irelandRightToWork':ireland})
     if expected:self.assertEqual(result['answers'][0]['value'],expected)
     else:self.assertFalse(result['answers']);self.assertEqual(result['unresolved'][0]['source'],'edit_profile')
 def test_ireland_does_not_establish_northern_ireland_or_conditional_work_rights(self):
  p=PROFILE|{'ukRightToWork':False,'irelandRightToWork':True,'irelandVisaRequired':False}
  for q in ['Are you authorized to work in Northern Ireland?','Are you authorized to work in the UK and Ireland?','Are you authorized to work in Ireland or the UK without sponsorship?','Do you need sponsorship in the UK or Ireland?']:
   with self.subTest(question=q):self.assertFalse(plan([field(q)],p)['answers'])
 def test_every_contact_field_uses_profile_instead_of_conflicting_cv(self):
  labels={'Zip code':'00100','Postal code':'00100','Location':'Abuja, Nigeria','Address':'10 Example Street','Street address':'10 Example Street','City':'Abuja','Country':'Nigeria','Phone number':'+2348012345678','Your current location':'Abuja, Nigeria','Where are you located?':'Abuja, Nigeria','Phone number (with country code)':'+2348012345678'}
  result=plan([field(label) for label in labels])
  self.assertFalse(result['unresolved'])
  for answer in result['answers']:
   self.assertEqual(answer['value'],labels[answer['field_id']]);self.assertEqual(answer['source'],'edit_profile')
 def test_missing_contact_does_not_fallback_to_cv_or_confirmed_old_answer(self):
  result=plan([field('Location'),field('Phone number')],{},confirmedAnswers=[{'question':'Location','value':'Old confirmed place'}])
  self.assertFalse(result['answers']);self.assertEqual(len(result['unresolved']),2)
  self.assertTrue(all('Edit Profile' in x['reason'] for x in result['unresolved']))
 def test_salary_uses_saved_amount_not_research_or_old_confirmed_answer(self):
  result=plan([field('Expected annual salary in USD','number')],confirmedAnswers=[{'question':'Expected annual salary in USD','value':'999999'}])
  self.assertEqual(result['answers'][0]['value'],'24000');self.assertEqual(result['answers'][0]['source'],'edit_profile')
 def test_salary_converts_year_to_month_and_preserves_text_units(self):
  profile=PROFILE|{'expectedSalary':{'amount':50000,'currency':'USD','period':'year'}}
  self.assertEqual(plan([field('Monthly salary expectation in USD','number')],profile)['answers'][0]['value'],'4166.67')
  self.assertEqual(plan([field('Expected salary')])['answers'][0]['value'],'USD 2000 per month')
 def test_numeric_text_field_gets_numeric_saved_amount(self):
  self.assertEqual(plan([field('Expected annual salary USD',numeric=True)])['answers'][0]['value'],'24000')
 def test_missing_salary_never_uses_available_research(self):
  result=plan([field('Expected salary')],PROFILE|{'expectedSalary':None})
  self.assertFalse(result['answers']);self.assertIn('research and guesses are disabled',result['unresolved'][0]['reason'])
 def test_salary_does_not_invent_current_history_hours_or_exchange_rates(self):
  for label,kind in [('Current salary in USD per year','number'),('Present compensation in USD per year','text'),('Minimum salary USD per year','number'),('Expected annual salary in GBP','number'),('Expected annual salary in naira','text'),('Expected hourly salary USD','number'),('Expected salary','number'),('Annual salary $','number'),('Expected annual salary in Canadian dollars','text')]:
   with self.subTest(label=label):self.assertFalse(plan([field(label,kind)])['answers'])
 def test_select_country_matches_only_offered_option(self):
  self.assertEqual(plan([field('Country','select',options=['Nigeria','United Kingdom'])])['answers'][0]['value'],'Nigeria')
  self.assertFalse(plan([field('Country','select',options=['UK','US'])])['answers'])
 def test_unrelated_location_questions_do_not_use_home_address(self):
  self.assertFalse(plan([field('Previous employer address'),field('Country of citizenship'),field('Are you willing to relocate?')])['answers'])
 def test_research_does_not_visit_supplied_salary_sources(self):
  visited=[]
  result=fetch_research({'salaryEvidence':[{'source_url':'https://salary.example/report','excerpt':'A long salary observation that should not be fetched anymore.'}]},fetch=lambda url:visited.append(url))
  self.assertFalse(visited);self.assertFalse(result['salary_evidence'])

if __name__=='__main__':unittest.main()
