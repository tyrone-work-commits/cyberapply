from datetime import datetime, timezone
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from application_agent.restart_recovery import RestartRecovery, computer_boot_at


def test_windows_boot_stamp_does_not_move_forward_when_sleep_time_is_included():
    uptime=Mock(return_value=600000)
    with patch('application_agent.restart_recovery.sys.platform','win32'), patch('application_agent.restart_recovery.ctypes.windll.kernel32.GetTickCount64',uptime), patch('application_agent.restart_recovery.time.time',return_value=1800000600):
        before=computer_boot_at()
        uptime.return_value=4200000
        with patch('application_agent.restart_recovery.time.time',return_value=1800004200):
            assert computer_boot_at()==before
    assert datetime.fromisoformat(before).timestamp()==1800000000


def test_parallel_workers_share_one_bounded_check_without_browser_control_or_secret_body():
    call=Mock(return_value={'restored':2});now=[100.0]
    monitor=RestartRecovery(call,'2026-11-24T08:00:00+00:00',clock=lambda:now[0])
    for _ in range(10):monitor.check('https://site.example','private-token','private-service')
    assert call.call_count==1
    assert call.call_args.args[2]=='/api/application-agent/restart-recovery'
    assert call.call_args.args[3]=={'version':1,'computerBootAt':'2026-11-24T08:00:00+00:00','runnerStartedAt':monitor.started_at}
    assert call.call_args.kwargs['timeout']==8
    now[0]=131;monitor.check('https://site.example','private-token');assert call.call_count==2


def test_failed_check_never_replays_and_retries_only_after_backoff():
    call=Mock(side_effect=OSError('Offline'));now=[0.0];monitor=RestartRecovery(call,'boot',clock=lambda:now[0])
    monitor.check('site','token');monitor.check('site','token');assert call.call_count==1
    now[0]=30;monitor.check('site','token');assert call.call_count==2


def test_unavailable_boot_evidence_and_busy_monitor_do_not_block_ordinary_work():
    call=Mock()
    with patch('application_agent.restart_recovery.computer_boot_at',return_value=None):
        RestartRecovery(call).check('site','token')
    monitor=RestartRecovery(call,'boot');monitor.lock.acquire()
    try:monitor.check('site','token')
    finally:monitor.lock.release()
    call.assert_not_called()


def test_older_site_backoff_is_compatible_and_boot_api_failure_is_safe():
    call=Mock(side_effect=HTTPError('site',404,'Old deployment',{},None));now=[0.0]
    monitor=RestartRecovery(call,'boot',clock=lambda:now[0]);monitor.check('site','token');now[0]=31;monitor.check('site','token');assert call.call_count==1
    with patch('application_agent.restart_recovery.sys.platform','win32'), patch('application_agent.restart_recovery.ctypes.windll.kernel32.GetTickCount64',side_effect=OSError):
        assert computer_boot_at() is None
