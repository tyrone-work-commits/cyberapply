import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from application_agent.desktop_notifications import DesktopNotifications,show_notices,APP_URL

SITE='https://cyberapply-internal.covenda-1182.chatgpt.site'
def connection(owner='owner'):return json.dumps({'site':SITE,'token':'ca2.'+owner+'.'+'a'*64})
def notice(key='request|answers:claim',kind='input'):return {'key':key,'kind':kind,'company':'Fictional employer','role':'Test role'}

class DesktopNotificationTests(unittest.TestCase):
 def test_repeated_checkins_and_restart_do_not_repeat_the_same_pause(self):
  with TemporaryDirectory() as folder:
   calls=[]
   def send(items):calls.extend(items);return {item['tag'] for item in items}
   first=DesktopNotifications(folder,send,lambda:1000)
   for _ in range(3):first.deliver(SITE,connection(),[notice()])
   DesktopNotifications(folder,send,lambda:1010).deliver(SITE,connection(),[notice()])
   self.assertEqual(len(calls),1)
   first.deliver(SITE,connection(),[notice('request|answers:new-claim'),notice('request|manual:one:ready','submit')])
   self.assertEqual(len(calls),3);self.assertEqual(calls[-1]['kind'],'submit')
   saved=''.join(p.read_text() for p in Path(folder).rglob('*.json'))
   for private in ['ca2.','Fictional','Test role','request|']:self.assertNotIn(private,saved)
 def test_owner_namespaces_and_batches_keep_multiple_jobs_independent(self):
  with TemporaryDirectory() as folder:
   batches=[]
   def send(items):batches.append(items);return {item['tag'] for item in items}
   n=DesktopNotifications(folder,send,lambda:1000);rows=[notice(str(i)) for i in range(15)]
   n.deliver(SITE,connection(),rows);n.deliver(SITE,connection(),rows)
   self.assertEqual([len(b) for b in batches],[10,5])
   n.deliver(SITE,connection('another'),[notice('0')]);self.assertEqual(len(batches),3)
 def test_failed_os_delivery_is_bounded_and_does_not_mark_sent(self):
  with TemporaryDirectory() as folder:
   now=[1000];calls=[]
   n=DesktopNotifications(folder,lambda items:(calls.append(items) or set()),lambda:now[0])
   n.deliver(SITE,connection(),[notice()]);n.deliver(SITE,connection(),[notice()]);self.assertEqual(len(calls),1)
   now[0]=1301;n.deliver(SITE,connection(),[notice()]);self.assertEqual(len(calls),2)
   self.assertNotIn('sentAt',''.join(p.read_text() for p in Path(folder).rglob('*.json')))
 def test_malformed_metadata_is_ignored_and_untrusted_text_is_data_only(self):
  with TemporaryDirectory() as folder:
   calls=[];n=DesktopNotifications(folder,lambda items:(calls.extend(items) or {i['tag'] for i in items}))
   n.deliver(SITE,connection(),[None,{},notice(kind='unknown'),{**notice(),'key':4},{**notice(),'company':'A\n<script>$(anything)</script>','role':'X & Y'}])
   self.assertEqual(len(calls),1);self.assertNotIn('\n',calls[0]['body']);self.assertIn('$(anything)',calls[0]['body'])
 def test_windows_transport_uses_fixed_script_stdin_and_returns_os_acceptance(self):
  from types import SimpleNamespace
  with patch('application_agent.desktop_notifications.sys.platform','win32'),patch('application_agent.desktop_notifications.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='{"sent":["fixture-tag"]}')) as run:
   self.assertEqual(show_notices([{'kind':'input','body':'Test only','tag':'fixture-tag'}]),{'fixture-tag'})
   args,kwargs=run.call_args;self.assertIn('-File',args[0]);self.assertNotIn('Test only',str(args[0]));self.assertNotIn('-Command',args[0])
   self.assertEqual(json.loads(kwargs['input'])['url'],APP_URL);self.assertLessEqual(kwargs['timeout'],20)
  script=Path('application_agent/windows_notifications.ps1').read_text(encoding='utf-8')
  self.assertIn('activationType=`"protocol`"',script);self.assertIn('<audio src=`"ms-winsoundevent:Notification.Default`"/>',script);self.assertNotIn('silent=`"true`"',script);self.assertNotIn('loop=',script);self.assertIn('CyberApplyToastIdentity',script)
 def test_notification_backend_error_never_propagates_to_application_work(self):
  with TemporaryDirectory() as folder:
   def fail(_):raise OSError('Fixture failure')
   DesktopNotifications(folder,fail).deliver(SITE,connection(),[notice()])
  with patch('application_agent.desktop_notifications.sys.platform','win32'),patch('application_agent.desktop_notifications.subprocess.run',side_effect=OSError('Fixture failure')):
   self.assertEqual(show_notices([]),set())
