import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
from application_agent.background import configure
from application_agent.background import protect, retry_delay

class BackgroundTests(unittest.TestCase):
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
