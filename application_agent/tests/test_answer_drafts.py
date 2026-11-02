import unittest
from application_agent.answer_drafts import narrative_draft, narrative_evidence


class WrappedCvDraftTests(unittest.TestCase):
    def test_rejoins_wrapped_evidence_and_keeps_bullet_boundaries(self):
        cv = ('EXPERIENCE\n• Built Python services, integrating secure\n'
              'coding practices across the development lifecycle.\n'
              '• Implemented access control\nfor application users.\n'
              'PROJECTS\nGitHub: https://example.test/project\n')
        evidence = narrative_evidence(cv)
        self.assertEqual(evidence, [
            'Built Python services, integrating secure coding practices across the development lifecycle.',
            'Implemented access control for application users.'])
        answer = narrative_draft('Describe your relevant work experience', cv, {}, 'I would discuss priorities with the team.')
        self.assertIn('lifecycle. Implemented', answer)
        self.assertNotIn('PROJECTS', answer)

    def test_dangling_fragment_is_not_a_work_claim(self):
        self.assertEqual(narrative_evidence('Built secure applications with'), [])


if __name__ == '__main__':
    unittest.main()
