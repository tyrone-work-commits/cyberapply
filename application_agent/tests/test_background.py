import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
from application_agent.background import configure
from application_agent.background import protect, retry_delay, status
import json

class BackgroundTests(unittest.TestCase):
    def test_temporary_windows_status_reader_does_not_stop_the_runner(self):
        with TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'status.json').write_text('{"state":"old"}',encoding='utf-8')
            replace=Path.replace
            calls=[]
            def transient(path,target):
                calls.append(target)
                if len(calls)<3:raise PermissionError('temporary Windows reader')
                return replace(path,target)
            with patch('application_agent.background.data_dir',return_value=root),patch.object(Path,'replace',transient),patch('application_agent.background.time.sleep'):
                status('running',last_result='queue_empty')
            self.assertEqual(json.loads((root/'status.json').read_text())['state'],'running')
            self.assertFalse((root/'status.tmp').exists())

    def test_persistent_status_access_error_keeps_previous_record(self):
        with TemporaryDirectory() as folder:
            root=Path(folder);original='{"state":"old"}'
            (root/'status.json').write_text(original,encoding='utf-8')
            with patch('application_agent.background.data_dir',return_value=root),patch.object(Path,'replace',side_effect=PermissionError('blocked')),patch('application_agent.background.time.sleep') as pause:
                with self.assertRaises(PermissionError):status('running')
                self.assertLessEqual(pause.call_count,8)
            self.assertEqual((root/'status.json').read_text(),original)

    def test_connection_is_encrypted_and_round_trips_for_current_user(self):
        raw=b'{"token":"test-only-never-valid","site":"https://example.test"}'
        encrypted=protect(raw)
        self.assertNotIn(raw,encrypted)
        self.assertEqual(protect(encrypted,decrypt=True),raw)

    def test_network_backoff_is_bounded(self):
        self.assertEqual(retry_delay(1),10)
        self.assertEqual(retry_delay(4),80)
        self.assertEqual(retry_delay(20),300)

    def test_invalid_ciphertext_is_rejected(self):
        with self.assertRaises(OSError):
            protect(b'not-a-protected-credential',decrypt=True)

    def test_invalid_connection_cannot_install_or_start(self):
        with patch('application_agent.background.install_startup') as install:
            with self.assertRaises(ValueError):
                configure('not-a-valid-token')
            install.assert_not_called()

    def test_setup_stores_only_ciphertext_and_starts_without_secret_arguments(self):
        with TemporaryDirectory() as folder:
            raw='{"site":"https://cyberapply-internal.covenda-1182.chatgpt.site","token":"ca2.owner.'+'a'*64+'"}'
            with patch('application_agent.background.data_dir',return_value=Path(folder)), patch('application_agent.background.install_startup',return_value=Path('pythonw.exe')), patch('application_agent.background.subprocess.Popen') as launch:
                configure(raw)
                saved=(Path(folder)/'connection.dat').read_bytes()
                self.assertNotIn(raw.encode(),saved)
                self.assertEqual(protect(saved,decrypt=True),raw.encode())
                self.assertNotIn('ca2.',str(launch.call_args))
