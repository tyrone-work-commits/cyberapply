import unittest
from application_agent.journey import greenhouse_source, matching_greenhouse_embed, Journey
from application_agent.browser import automatic_application_hosts, static_asset_hosts


SOURCE={'provider':'greenhouse','region':'global','board':'fixture','externalId':'123','boardUrl':'https://job-boards.greenhouse.io/fixture'}
JOB={'url':'https://employer.example/jobs/123?gh_jid=123','source':SOURCE}


class JourneyTests(unittest.TestCase):
    def test_feed_identity_is_required_for_embed_permissions(self):
        self.assertEqual(greenhouse_source(JOB),{'board':'fixture','posting':'123'})
        self.assertIn('job-boards.greenhouse.io',automatic_application_hosts(JOB))
        self.assertEqual(static_asset_hosts(JOB),{'job-boards.cdn.greenhouse.io'})
        for job in [{**JOB,'source':None},{**JOB,'url':'https://employer.example/jobs/456?gh_jid=456'},
                    {**JOB,'source':{**SOURCE,'boardUrl':'https://evil.example/fixture'}},
                    {**JOB,'source':{**SOURCE,'board':'../other'}},
                    {**JOB,'url':'https://employer.example/?gh_jid=123&gh_jid=456'}]:
            self.assertIsNone(greenhouse_source(job))
            self.assertNotIn('job-boards.greenhouse.io',automatic_application_hosts(job))

    def test_observed_embed_must_match_exact_board_and_vacancy(self):
        src=greenhouse_source(JOB)
        url='https://job-boards.greenhouse.io/embed/job_app?for=fixture&token=123&validityToken=private'
        self.assertTrue(matching_greenhouse_embed(url,src))
        for bad in [url.replace('token=123','token=456'),url.replace('for=fixture','for=other'),
                    url+'&token=123',url+'&redirect=https://evil.example',url.replace('greenhouse.io/','greenhouse.io.evil.example/'),
                    url.replace('https:','http:'),url+'#other',url.replace('/embed/job_app','/submit')]:
            self.assertFalse(matching_greenhouse_embed(bad,src))
        self.assertFalse(matching_greenhouse_embed(url,None))

    def test_inspections_and_elapsed_time_have_independent_bounds(self):
        now=[0];report={};journey=Journey(report,lambda:now[0])
        for _ in range(24):self.assertTrue(journey.inspect())
        self.assertFalse(journey.inspect())
        self.assertEqual(report['journey']['stop_reason'],'progress_budget')
        journey=Journey({},lambda:now[0]);now[0]=300
        self.assertFalse(journey.inspect())
