import unittest
from tempfile import TemporaryDirectory
from application_agent.login_sessions import LoginSessions,scoped_state,MAX_AGE
from application_agent.login_sessions import employer_partition

JOB={'url':'https://boards.greenhouse.io/acme/jobs/123'}
HOSTS={'boards.greenhouse.io','job-boards.greenhouse.io'}
STATE={'cookies':[{'name':'candidate_session','value':'fake-session-secret','domain':'boards.greenhouse.io','path':'/','expires':-1,'httpOnly':True,'secure':True,'sameSite':'Lax'}], 'origins':[]}

class LoginSessionTests(unittest.TestCase):
    def test_aliases_share_only_the_same_employer_and_embed_boards_are_isolated(self):
        self.assertEqual(employer_partition(JOB),employer_partition({'url':'https://job-boards.greenhouse.io/acme/jobs/456'}))
        self.assertNotEqual(employer_partition({'url':'https://job-boards.greenhouse.io/embed/job_app?for=acme'}),employer_partition({'url':'https://job-boards.greenhouse.io/embed/job_app?for=other'}))
        self.assertNotEqual(employer_partition(JOB),employer_partition({'url':'https://boards.eu.greenhouse.io/acme/jobs/123'}))
    def test_encrypted_round_trip_and_owner_employer_isolation(self):
        with TemporaryDirectory() as root:
            a=LoginSessions('https://app.example','owner-a',root=root)
            a.save(JOB,HOSTS,STATE)
            self.assertNotIn(b'fake-session-secret',a.path(JOB).read_bytes())
            self.assertEqual(a.load(JOB,HOSTS),STATE)
            self.assertIsNone(LoginSessions('https://app.example','owner-b',root=root).load(JOB,HOSTS))
            self.assertIsNone(a.load({'url':'https://boards.greenhouse.io/other/jobs/123'},HOSTS))

    def test_refresh_does_not_extend_sign_in_retention(self):
        with TemporaryDirectory() as root:
            now=[1000]
            store=LoginSessions('site','owner',root=root,clock=lambda:now[0])
            store.save(JOB,HOSTS,STATE)
            now[0]+=MAX_AGE-10
            store.save(JOB,HOSTS,STATE,refresh=True)
            self.assertIsNotNone(store.load(JOB,HOSTS))
            now[0]+=11
            self.assertIsNone(store.load(JOB,HOSTS))

    def test_foreign_browser_data_is_not_saved_or_returned(self):
        state={'cookies':STATE['cookies']+[{'domain':'other.example','name':'foreign','value':'excluded'}], 'origins':[{'origin':'https://other.example','localStorage':[]},{'origin':'http://boards.greenhouse.io','localStorage':[]}]}
        self.assertEqual(scoped_state(state,HOSTS),STATE)

    def test_clear_is_scoped_to_current_cyberapply_owner(self):
        with TemporaryDirectory() as root:
            a=LoginSessions('site','a',root=root);b=LoginSessions('site','b',root=root)
            a.save(JOB,HOSTS,STATE);b.save(JOB,HOSTS,STATE)
            a.clear()
            self.assertIsNone(a.load(JOB,HOSTS))
            self.assertEqual(b.load(JOB,HOSTS),STATE)

    def test_invalid_encrypted_cache_is_ignored(self):
        with TemporaryDirectory() as root:
            store=LoginSessions('site','owner',root=root)
            store.path(JOB).parent.mkdir(parents=True)
            store.path(JOB).write_bytes(b'not-a-session')
            self.assertIsNone(store.load(JOB,HOSTS))
