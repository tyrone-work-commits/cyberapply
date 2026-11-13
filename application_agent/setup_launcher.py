"""Register a per-user setup-only protocol, without tokens or shell execution."""
from pathlib import Path
import subprocess
import sys

SCHEME='cyberapply-agent'
SETUP_URI=SCHEME+'://setup'
KEY='Software\\Classes\\'+SCHEME

def launcher_command():
    pythonw=Path(sys.executable).with_name('pythonw.exe')
    script=Path(__file__).with_name('launch_setup.py').resolve()
    if not pythonw.is_file() or not script.is_file():raise RuntimeError('CyberApply setup launcher is unavailable.')
    return subprocess.list2cmdline([str(pythonw),str(script)])+' "%1"'

def register_setup_launcher():
    import winreg
    command=launcher_command()
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,KEY+'\\shell\\open\\command') as key:
            existing=winreg.QueryValueEx(key,'')[0]
            if existing!=command:raise RuntimeError('Another setup launcher is registered for this protocol.')
    except FileNotFoundError:pass
    for suffix,name,value in [('',None,'URL:CyberApply agent setup'),('','URL Protocol',''),('\\shell\\open\\command',None,command)]:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER,KEY+suffix) as key:
            winreg.SetValueEx(key,name,0,winreg.REG_SZ,value)
    return SETUP_URI

def unregister_setup_launcher():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,KEY+'\\shell\\open\\command') as key:
            if winreg.QueryValueEx(key,'')[0]!=launcher_command():return
        for suffix in ['\\shell\\open\\command','\\shell\\open','\\shell','']:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER,KEY+suffix)
    except FileNotFoundError:pass

def open_setup_uri(uri):
    if uri not in {SETUP_URI,SETUP_URI+'/'}:raise ValueError('Only the CyberApply setup link is supported.')
    from .background import setup_window
    setup_window()
