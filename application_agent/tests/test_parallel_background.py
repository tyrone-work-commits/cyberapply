import json
import pytest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock,patch
from application_agent import background


def test_normal_background_pool_uses_ten_independent_workers_and_existing_credentials():
 with TemporaryDirectory() as root:
  folder=Path(root);(folder/'connection.dat').write_bytes(b'encrypted-fixture')
  kernel=MagicMock();kernel.CreateMutexW.return_value=11;kernel.GetLastError.return_value=0
  def pool(work,stopping,publish,**options):
   assert options['limit']==10 and not stopping()
   assert work(lambda state:None)
   publish('working',activeApplications=1,parallelSlots=10)
  with patch.object(background,'data_dir',return_value=folder),patch.object(background.ctypes.windll,'kernel32',kernel),patch.object(background,'protect',return_value=b'ca2.owner.'+b'a'*64),patch.object(background,'run_once',return_value=True) as job,patch('application_agent.parallel_runner.run_pool',side_effect=pool),patch('application_agent.presence.start'),patch('application_agent.presence.stop'),patch('application_agent.restart_recovery.RestartRecovery'),patch.object(background.subprocess,'Popen') as start:
   background.run();assert job.call_args.kwargs['parallel'] is True
   assert job.call_args.kwargs['background_notifications'] is True
   assert json.loads((folder/'status.json').read_text())['parallelSlots']==10
   start.assert_not_called();kernel.CloseHandle.assert_called_once_with(11)


@pytest.mark.parametrize('marker,launches',[(None,1),('finish-current-run-before-identity-close-return:00000000-0000-4000-8000-000000000001',1),('',0)])
def test_companion_preserves_legacy_status_and_never_kills_a_browser(marker,launches):
 with TemporaryDirectory() as root:
  folder=Path(root);prior=json.dumps({'pid':123,'state':'working'});(folder/'status.json').write_text(prior);(folder/'connection.dat').write_bytes(b'encrypted-fixture')
  if marker is not None:(folder/'stop').write_text(marker)
  kernel=MagicMock();kernel.CreateMutexW.side_effect=[11,12];kernel.GetLastError.return_value=0;kernel.OpenProcess.return_value=13;kernel.WaitForSingleObject.side_effect=[258,0,0]
  def pool(work,stopping,publish,**options):
   assert options['limit']==10
   if marker=='':assert stopping()
   else:
    assert not stopping()
    assert work(lambda state:None)
    assert stopping()
   publish('stopped',activeApplications=0,parallelSlots=10)
  with patch.object(background,'data_dir',return_value=folder),patch.object(background.ctypes.windll,'kernel32',kernel),patch.object(background,'protect',return_value=b'ca2.owner.'+b'a'*64),patch.object(background,'run_once',return_value=True),patch('application_agent.parallel_runner.run_pool',side_effect=pool),patch('application_agent.presence.start'),patch('application_agent.presence.stop'),patch('application_agent.restart_recovery.RestartRecovery'),patch.object(background.subprocess,'Popen') as start:
   background.run(123);assert (folder/'status.json').read_text()==prior
   assert json.loads((folder/'parallel/status.json').read_text())['parallelSlots']==10
   assert start.call_count==launches
   if launches:assert start.call_args.args[0][-1]=='run';assert 'ca2.' not in str(start.call_args)
   assert kernel.CloseHandle.call_count==3;kernel.TerminateProcess.assert_not_called()


def test_unverified_legacy_pid_cannot_start_a_companion_or_touch_the_existing_session():
 with TemporaryDirectory() as root:
  folder=Path(root);(folder/'status.json').write_text('{"pid":999,"state":"working"}')
  kernel=MagicMock();kernel.GetLastError.return_value=0
  with patch.object(background,'data_dir',return_value=folder),patch.object(background.ctypes.windll,'kernel32',kernel),patch('application_agent.parallel_runner.run_pool') as pool,patch.object(background.subprocess,'Popen') as start:
   try:background.run(123)
   except ValueError:pass
   else:raise AssertionError('A foreign legacy status was accepted')
   pool.assert_not_called();start.assert_not_called();kernel.OpenProcess.assert_not_called()


def test_fresh_singleton_resumes_after_old_upgrade_but_honors_new_user_stop():
 with TemporaryDirectory() as root:
  folder=Path(root);marker='finish-current-run-before-identity-close-return:00000000-0000-4000-8000-000000000001'
  (folder/'stop').write_text(marker)
  kernel=MagicMock();kernel.CreateMutexW.return_value=11;kernel.GetLastError.return_value=0
  def pool(work,stopping,publish,**options):
   assert not stopping()
   (folder/'stop').write_text('')
   assert stopping()
  with patch.object(background,'data_dir',return_value=folder),patch.object(background.ctypes.windll,'kernel32',kernel),patch('application_agent.parallel_runner.run_pool',side_effect=pool),patch('application_agent.presence.start'),patch('application_agent.presence.stop'),patch.object(background.subprocess,'Popen') as start:
   background.run();start.assert_not_called()


def test_existing_singleton_never_ignores_a_stop_or_starts_another_runner():
 kernel=MagicMock();kernel.CreateMutexW.return_value=11;kernel.GetLastError.return_value=183
 with patch.object(background.ctypes.windll,'kernel32',kernel),patch('application_agent.parallel_runner.run_pool') as pool,patch.object(background.subprocess,'Popen') as start:
  background.run();pool.assert_not_called();start.assert_not_called()
