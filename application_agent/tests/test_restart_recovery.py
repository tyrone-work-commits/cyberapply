from unittest.mock import Mock
from pathlib import Path
from application_agent.restart_recovery import RestartRecovery


def test_legacy_restart_monitor_never_calls_site_or_rebuilds_a_browser():
    call=Mock()
    monitor=RestartRecovery(call, 'old-boot', clock=lambda:100)
    for _ in range(20):
        monitor.check('https://site.example','private-token','private-service')
    call.assert_not_called()


def test_background_startup_has_no_automatic_recovery_monitor():
    source=Path('application_agent/background.py').read_text()
    assert 'RestartRecovery' not in source
    assert 'restart_recovery.check' not in source
