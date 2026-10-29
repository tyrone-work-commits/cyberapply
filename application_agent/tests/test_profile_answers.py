import unittest
from application_agent.reasoning import build_plan
from application_agent.research import fetch_research

PROFILE={'zipCode':'00100','location':'Abuja, Nigeria','address':'10 Example Street','city':'Abuja','country':'Nigeria','phone':'+2348012345678','expectedSalary':{'amount':2000,'currency':'USD','period':'month'}}
CV='Test Candidate\ntest@example.test\nLocation: Wrong CV City\n+447700900123\nExperience\nSOC Analyst | Jan 2023 - Dec 2024\nInvestigated SIEM alerts.'
def field(label,kind='text',**kw):return {'id':label,'label':label,'type':kind,'required':True,**kw}
def plan(fields,profile=PROFILE,**kw):return build_plan({'cv':{'text':CV},'applicantProfile':profile,**kw},fields,{'salary_evidence':[{'low':90000,'high':100000,'currency':'USD','period':'year'}]})

class ProfileAnswerTests(unittest.TestCase):
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
  for label,kind in [('Current salary in USD per year','number'),('Minimum salary USD per year','number'),('Expected annual salary in GBP','number'),('Expected hourly salary USD','number'),('Expected salary','number'),('Annual salary $','number'),('Expected annual salary in Canadian dollars','text')]:
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
