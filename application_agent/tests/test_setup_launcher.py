import unittest
from unittest.mock import patch
from application_agent.setup_launcher import SETUP_URI,open_setup_uri,launcher_command

class SetupLauncherTests(unittest.TestCase):
 def test_only_exact_setup_uri_can_open_the_window(self):
  with patch('application_agent.background.setup_window') as setup:
   open_setup_uri(SETUP_URI);setup.assert_called_once_with()
  for uri in ['cyberapply-agent://run','cyberapply-agent://setup?token=secret','cyberapply-agent://setup#anything','cyberapply-agent://setup/evil','https://example.test','cyberapply-agent://setup " --submit','cyberapply-agent://user:secret@setup']:
   with self.subTest(uri=uri),patch('application_agent.background.setup_window') as setup:
    with self.assertRaises(ValueError):open_setup_uri(uri)
    setup.assert_not_called()
 def test_registry_command_is_fixed_and_uri_argument_is_quoted(self):
  command=launcher_command()
  self.assertTrue(command.endswith(' "%1"'))
  self.assertIn('launch_setup.py',command)
  self.assertIn('pythonw.exe',command)
  self.assertNotIn('powershell',command.lower());self.assertNotIn('cmd.exe',command.lower())

if __name__=='__main__':unittest.main()
