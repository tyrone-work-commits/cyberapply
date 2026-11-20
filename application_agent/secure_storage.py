"""Windows current-user encryption for local agent secrets."""
import ctypes
from ctypes import wintypes
import sys


class Blob(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]


def protect(raw:bytes,decrypt=False):
    if sys.platform!='win32':
        raise RuntimeError('Encrypted agent storage requires Windows.')
    buf=ctypes.create_string_buffer(raw)
    source=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)))
    target=Blob()
    api=ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    api.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    api.restype=wintypes.BOOL
    if not api(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):
        raise OSError('Windows could not access the encrypted connection.')
    try:
        return ctypes.string_at(target.data,target.size)
    finally:
        free=ctypes.windll.kernel32.LocalFree
        free.argtypes=[ctypes.c_void_p]
        free.restype=ctypes.c_void_p
        free(target.data)
