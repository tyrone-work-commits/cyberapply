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

SITE = 'https://cyberapply-internal.covenda-1182.chatgpt.site'
TASK_NAME = 'CyberApply Application Agent'
ROOT = Path(__file__).resolve().parent.parent


def data_dir():
    return Path(os.environ['LOCALAPPDATA']) / 'CyberApply' / 'application-agent'


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(raw: bytes, decrypt=False):
    if sys.platform != 'win32':
        raise RuntimeError('Background setup requires Windows.')
    buf = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    api = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    api.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    api.restype=wintypes.BOOL
    # CRYPTPROTECT_UI_FORBIDDEN, current user scope; never machine-wide.
    if not api(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise OSError('Windows could not access the encrypted connection.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        free=ctypes.windll.kernel32.LocalFree
        free.argtypes=[ctypes.c_void_p]
        free.restype=ctypes.c_void_p
        free(target.data)


def status(state, **extra):
    folder = data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    value = {'state': state, 'at': datetime.now(timezone.utc).isoformat(), 'pid': os.getpid(), **extra}
    temp = folder / 'status.tmp'
    temp.write_text(json.dumps(value), encoding='utf-8')
    temp.replace(folder / 'status.json')


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


def run():
    # One runner per Windows account, including manual starts and login startup.
    kernel=ctypes.windll.kernel32
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,wintypes.BOOL,wintypes.LPCWSTR]
    kernel.CreateMutexW.restype=wintypes.HANDLE
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    mutex=kernel.CreateMutexW(None, False, 'Local\\CyberApplyApplicationAgentV2')
    if not mutex:
        raise OSError('Could not create the background runner lock.')
    if ctypes.windll.kernel32.GetLastError()==183:
        ctypes.windll.kernel32.CloseHandle(mutex)
        return
    failures=0
    try:
        while not (data_dir() / 'stop').exists():
            try:
                raw=protect((data_dir() / 'connection.dat').read_bytes(), decrypt=True).decode('utf-8')
                token, service=parse_connection(raw, SITE)
                status('checking')
                worked=run_once(SITE, token, submit=True, browser_channel='chrome', site_access_token=service)
                failures=0
                status('running', last_check=datetime.now(timezone.utc).isoformat(), last_result='processed_request' if worked else 'queue_empty')
                delay=5
            except HTTPError as error:
                if error.code in (401,403):
                    status('reconnect_required', http_status=error.code)
                    delay=60
                else:
                    failures+=1
                    status('waiting_for_connection',http_status=error.code)
                    delay=retry_delay(failures)
            except (URLError, OSError):
                failures+=1
                status('waiting_for_connection')
                delay=retry_delay(failures)
            except Exception:
                # Never replay a form after unknown delivery. The Site's lease
                # and uncertain-outcome rules prevent reclaiming in-flight work.
                failures+=1
                status('needs_review')
                delay=retry_delay(failures)
            for _ in range(delay):
                if (data_dir() / 'stop').exists():
                    break
                time.sleep(1)
        status('stopped')
    finally:
        ctypes.windll.kernel32.CloseHandle(mutex)


def setup_window():
    import tkinter as tk
    from tkinter import messagebox
    window=tk.Tk()
    window.title('CyberApply — automatic background agent')
    window.geometry('570x300')
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
        messagebox.showinfo('CyberApply','Automatic startup is installed and the background agent has started. You can close this window.')
        window.destroy()
    tk.Button(window,text='Enable automatic background applications',command=submit).pack()
    entry.focus_set()
    window.mainloop()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['setup','run','status','stop','uninstall'])
    args=parser.parse_args()
    if args.action=='setup':
        setup_window()
    elif args.action=='run':
        run()
    elif args.action=='status':
        path=data_dir()/'status.json'
        print(path.read_text(encoding='utf-8') if path.exists() else '{"state":"not_configured"}')
    elif args.action in ('stop','uninstall'):
        data_dir().mkdir(parents=True,exist_ok=True)
        (data_dir()/'stop').touch()
        if args.action=='uninstall':
            startup_link().unlink(missing_ok=True)
            (data_dir()/'connection.dat').unlink(missing_ok=True)
        print('Background agent stopping.' if args.action=='stop' else 'Startup and local credential removed. Disconnect in CyberApply Settings to revoke the server credential.')


if __name__=='__main__':
    main()
