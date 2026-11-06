import json
import os
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from application_agent import presence

class PresenceTests(unittest.TestCase):
 def test_checkin_uses_private_connection_only_in_auth_headers(self):
  with TemporaryDirectory() as folder:
   path=Path(folder);(path/'connection.dat').write_bytes(b'encrypted-only')
   bundle={'site':'https://example.test','token':'ca2.owner.'+'a'*64,'serviceToken':'private'}
   with patch('application_agent.presence.protect',return_value=json.dumps(bundle).encode()),patch('application_agent.presence.call_site') as call:
    presence.publish(path,'https://example.test','working')
    args,kwargs=call.call_args
    self.assertEqual(args[2],'/api/application-agent/heartbeat');self.assertEqual(args[3],{'state':'working'});self.assertEqual(kwargs['timeout'],8)
    self.assertNotIn('private',args[2]);self.assertEqual(kwargs['site_access_token'],'private')
 def test_monitor_reports_during_work_and_stops_cleanly(self):
  with TemporaryDirectory() as folder:
   path=Path(folder);(path/'status.json').write_text(json.dumps({'pid':os.getpid(),'state':'working'}))
   seen=threading.Event()
   with patch('application_agent.presence.publish',side_effect=lambda *args,**kwargs:seen.set()) as publish:
    monitor=presence.start(path,'https://example.test',interval=.01)
    self.assertTrue(seen.wait(2));presence.stop(monitor)
    self.assertFalse(monitor.thread.is_alive());self.assertGreaterEqual(publish.call_count,1)
 def test_other_process_status_is_not_reported(self):
  with TemporaryDirectory() as folder:
   path=Path(folder);(path/'status.json').write_text(json.dumps({'pid':-1,'state':'running'}))
   with patch('application_agent.presence.publish') as publish:
    monitor=presence.start(path,'https://example.test',interval=.01);presence.stop(monitor);publish.assert_not_called()
 def test_active_connection_is_pinned_during_work(self):
  with TemporaryDirectory() as folder:
   path=Path(folder);(path/'status.json').write_text(json.dumps({'pid':os.getpid(),'state':'working'}))
   seen=threading.Event()
   with patch('application_agent.presence.publish',side_effect=lambda *args,**kwargs:seen.set()) as publish:
    monitor=presence.start(path,'https://example.test',interval=.01,get_connection=lambda:'active-private-bundle')
    self.assertTrue(seen.wait(2));presence.stop(monitor)
    self.assertEqual(publish.call_args.kwargs['connection'],'active-private-bundle')

if __name__=='__main__':unittest.main()
