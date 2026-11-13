import unittest
from unittest.mock import patch
from application_agent import runner

class SourceRefreshTests(unittest.TestCase):
 def setUp(self):runner._source_refresh_attempts.clear()
 def test_idle_source_check_is_bounded_and_never_queues_or_submits(self):
  with patch.object(runner,'call_site',return_value={}) as call:
   self.assertTrue(runner.maybe_refresh_sources('https://site.example','private',now=100))
   self.assertFalse(runner.maybe_refresh_sources('https://site.example','private',now=200))
   self.assertTrue(runner.maybe_refresh_sources('https://site.example','private',now=401))
   self.assertEqual(call.call_count,2)
   self.assertEqual(call.call_args.args[2],'/api/application-agent/sources/refresh')
   self.assertEqual(call.call_args.args[3],{})
 def test_old_site_or_feed_failure_is_not_replayed_in_a_tight_loop(self):
  with patch.object(runner,'call_site',side_effect=RuntimeError('old endpoint')) as call:
   self.assertFalse(runner.maybe_refresh_sources('https://site.example','private',now=100))
   self.assertFalse(runner.maybe_refresh_sources('https://site.example','private',now=101))
   self.assertEqual(call.call_count,1)
