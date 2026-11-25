"""Windows background runner. Credentials use current-user Windows DPAPI."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError

from .runner import parse_connection, run_once
from .secure_storage import protect

SITE = 'https://cyberapply-internal.covenda-1182.chatgpt.site'
TASK_NAME = 'CyberApply Application Agent'
ROOT = Path(__file__).resolve().parent.parent


def data_dir():
    return Path(os.environ['LOCALAPPDATA']) / 'CyberApply' / 'application-agent'


def status(state, *, folder=None, **extra):
    folder = Path(folder) if folder is not None else data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    value = {'state': state, 'at': datetime.now(timezone.utc).isoformat(), 'pid': os.getpid(), **extra}
    temp = folder / 'status.tmp'
    temp.write_text(json.dumps(value), encoding='utf-8')
    # Windows readers briefly hold the destination without delete sharing.
    # Preserve atomic status updates while allowing those readers to close.
    for attempt in range(8):
        try:
            temp.replace(folder / 'status.json')
            break
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(min(0.02 * 2**attempt, 0.25))


def startup_link():
    return Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs/Startup' / (TASK_NAME + '.lnk')


def install_startup():
    pythonw = Path(sys.executable).with_name('pythonw.exe')
    if not pythonw.is_file():
        raise RuntimeError('The Windows Python background executable is unavailable.')
    def quote(value):
        return "'" + str(value).replace("'", "''") + "'"
    script = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut(" + quote(startup_link()) + ");$s.TargetPath=" + quote(pythonw) + ";$s.Arguments='-m application_agent.background run';$s.WorkingDirectory=" + quote(ROOT) + ";$s.WindowStyle=7;$s.Description='CyberApply authorized CV application browser runner';$s.Save()"
    subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], check=True, creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    from .setup_launcher import register_setup_launcher
    register_setup_launcher()
    return pythonw


def configure(raw):
    parse_connection(raw, SITE)
    folder=data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    # Atomic replacement: the plaintext connection exists only in process memory.
    pending=folder / 'connection.new'
    pending.write_bytes(protect(raw.encode('utf-8')))
    pending.replace(folder / 'connection.dat')
    (folder / 'stop').unlink(missing_ok=True)
    pythonw=install_startup()
    subprocess.Popen([str(pythonw), '-m', 'application_agent.background', 'run'], cwd=ROOT,
                     creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def retry_delay(failures):
    return min(300, 5 * (2 ** min(failures, 6)))


def run(legacy_pid=None):
    # Keep the established login-startup singleton. A temporary companion may
    # keep the old serial process's exact browser. The server counts that claim
    # in the shared ten-application limit, including when it waits for a person.
    kernel=ctypes.windll.kernel32
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,wintypes.BOOL,wintypes.LPCWSTR]
    kernel.CreateMutexW.restype=wintypes.HANDLE
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    name='Local\\CyberApplyParallelCompanionV1' if legacy_pid else 'Local\\CyberApplyApplicationAgentV2'
    mutex=kernel.CreateMutexW(None, False, name)
    if not mutex:raise OSError('Could not create the background runner lock.')
    if kernel.GetLastError()==183:
        kernel.CloseHandle(mutex)
        return
    root=data_dir();folder=root/'parallel' if legacy_pid else root
    legacy_handle=keeper=None
    presence_stop=None
    legacy_alive=lambda:False
    try:
        if legacy_pid:
            saved=json.loads((root/'status.json').read_text(encoding='utf-8'))
            if saved.get('pid')!=legacy_pid or legacy_pid==os.getpid():
                raise ValueError('The previous application runner could not be verified.')
            kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
            kernel.OpenProcess.restype=wintypes.HANDLE
            kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
            kernel.WaitForSingleObject.restype=wintypes.DWORD
            legacy_handle=kernel.OpenProcess(0x00100000,False,legacy_pid)
            if not legacy_handle:raise OSError('The previous runner process is unavailable.')
            legacy_alive=lambda:kernel.WaitForSingleObject(legacy_handle,0)==258
            # Holding this existing named object prevents another login runner
            # from starting until the companion has drained its own browsers.
            keeper=kernel.CreateMutexW(None,False,'Local\\CyberApplyApplicationAgentV2')
            if not keeper:raise OSError('Could not retain the existing runner guard.')
        from . import presence
        from .desktop_notifications import DesktopNotifications
        from .parallel_runner import run_pool,MAX_PARALLEL_APPLICATIONS
        from .runner import call_site,maybe_refresh_sources
        from .location_choices import run_location_capture
        active_connection=[None]
        notifications=DesktopNotifications(root)
        status('checking',folder=folder)
        presence_stop=presence.start(folder,SITE,get_connection=lambda:active_connection[0],
            on_notices=lambda notices,connection:None if legacy_alive() else notifications.deliver(SITE,connection,notices))
        def connected():
            raw=protect((root/'connection.dat').read_bytes(),decrypt=True).decode('utf-8')
            token,service=parse_connection(raw,SITE)
            active_connection[0]=raw
            return token,service
        def work(on_state):
            token,service=connected()
            return run_once(SITE,token,submit=True,browser_channel='chrome',site_access_token=service,
                            on_state=on_state,background_notifications=True,parallel=True)
        def maintenance():
            token,service=connected()
            run_location_capture(SITE,token,call_site,service,'chrome')
            maybe_refresh_sources(SITE,token,service)
        run_pool(work,lambda:(root/'stop').exists() or bool(legacy_pid and not legacy_alive()),
                 lambda state,**extra:status(state,folder=folder,**extra),
                 limit=MAX_PARALLEL_APPLICATIONS,maintenance=maintenance)
    finally:
        if presence_stop:
            presence.stop(presence_stop)
            if (root/'stop').exists() and not legacy_alive():
                try:
                    if active_connection[0] is not None:presence.publish(folder,SITE,'stopped',connection=active_connection[0])
                except Exception:pass
        for handle in (keeper,legacy_handle,mutex):
            if handle:kernel.CloseHandle(handle)
    if legacy_pid and not (root/'stop').exists():
        # The old process ended and every companion browser finished naturally.
        # Start the standard ten-slot login runner; never replay an old claim.
        subprocess.Popen([str(Path(sys.executable).with_name('pythonw.exe')),'-m','application_agent.background','run'],
                         cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)


def setup_window():
    import tkinter as tk
    from tkinter import messagebox
    window=tk.Tk()
    window.title('CyberApply — automatic background agent')
    window.geometry('590x350')
    window.resizable(False,False)
    tk.Label(window,text='Connect your background application agent',font=('Segoe UI',13,'bold')).pack(pady=(20,10))
    tk.Label(window,text='Copy the private connection string from CyberApply Settings,\nthen paste it here. It stays encrypted under your Windows account.\n\nThis enables processing of your authorized Apply requests\nwhile this computer is awake and you are signed in.',font=('Segoe UI',10),justify='left').pack(padx=20)
    value=tk.StringVar()
    entry=tk.Entry(window,textvariable=value,show='•',width=68)
    entry.pack(padx=20,pady=15)
    def submit():
        try:
            configure(value.get().strip())
        except Exception:
            messagebox.showerror('Setup needs attention','Could not complete setup. Check the connection string and try again. No credential was printed or logged.')
            return
        value.set('')
        messagebox.showinfo('CyberApply','Automatic startup is enabled and the agent is starting. Check Account Settings for its live connection status. You can close this window.')
        window.destroy()
    local_status=tk.Label(window,text='',font=('Segoe UI',10),wraplength=540)
    local_status.pack(padx=20,pady=(0,12))
    def refresh_local():
        try:
            saved=json.loads((data_dir()/'status.json').read_text(encoding='utf-8'))
            state=str(saved.get('state','not_configured')).replace('_',' ')
            at=saved.get('at','')
            local_status.config(text=f'Background agent: {state}'+(f' · Last update {at[:19].replace("T"," ")} UTC' if at else ''))
        except (OSError,ValueError):local_status.config(text='Background agent: not configured')
        window.after(2000,refresh_local)
    refresh_local()
    tk.Button(window,text='Enable automatic background applications',command=submit).pack()
    entry.focus_set()
    window.mainloop()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['setup','run','assist','status','stop','uninstall','clear-sessions','register-setup'])
    parser.add_argument('--legacy-pid',type=int,help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.action=='assist' and (not args.legacy_pid or args.legacy_pid<=0):parser.error('A previous runner process is required.')
    if args.action!='assist' and args.legacy_pid is not None:parser.error('Unexpected previous runner process.')
    if args.action=='setup':
        setup_window()
    elif args.action=='register-setup':
        from .setup_launcher import register_setup_launcher
        print('Registered setup link:',register_setup_launcher())
    elif args.action in ('run','assist'):
        run(args.legacy_pid)
    elif args.action=='status':
        path=data_dir()/'status.json'
        print(path.read_text(encoding='utf-8') if path.exists() else '{"state":"not_configured"}')
    elif args.action=='clear-sessions':
        from .login_sessions import LoginSessions
        raw=protect((data_dir()/'connection.dat').read_bytes(),decrypt=True).decode('utf-8')
        token,_=parse_connection(raw,SITE)
        LoginSessions(SITE,token.split('.')[1]).clear()
        print('Saved employer sign-in sessions cleared for this CyberApply account.')
    elif args.action in ('stop','uninstall'):
        data_dir().mkdir(parents=True,exist_ok=True)
        (data_dir()/'stop').touch()
        if args.action=='uninstall':
            from .setup_launcher import unregister_setup_launcher
            unregister_setup_launcher()
            startup_link().unlink(missing_ok=True)
            (data_dir()/'connection.dat').unlink(missing_ok=True)
        print('Background agent stopping.' if args.action=='stop' else 'Startup and local credential removed. Disconnect in CyberApply Settings to revoke the server credential.')


if __name__=='__main__':
    main()
