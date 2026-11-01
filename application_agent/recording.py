"""Private temporary recording of the application browser, never the login browser."""
import base64
from datetime import datetime,timezone
from pathlib import Path
import tempfile
import threading
import time
from .video_encoder import FPS

MAX_RECORDING_BYTES=32_000_000
MAX_RECORDING_SECONDS=600
CHECKPOINT_SECONDS=10

class ApplicationRecording:
 def __init__(self,on_part=None):
  self.lock=threading.Lock();self.active=threading.Event();self.stop=threading.Event();self.discard=threading.Event()
  self.latest=None;self.final=None;self.info=None;self.path=None;self.partial=False;self.reason='';self.error=''
  self.on_part=on_part;self.parts=0;self.frames=0;self.bytes=0
  self.thread=threading.Thread(target=self._run,name='CyberApply private recording',daemon=True);self.thread.start()
 def offer(self,data):
  if isinstance(data,str) and 0<len(data)<=320000:
   with self.lock:self.latest=data
 def set_active(self,active):
  if active:self.active.set()
  else:
   self.active.clear()
   with self.lock:self.latest=None
 def finish_capture(self,data):
  if data:
   with self.lock:self.final=data
 def _run(self):
  encoder=None;next_frame=0;started=''
  def finish_part():
   nonlocal encoder
   if not encoder:return
   current=encoder;encoder=None;current.close()
   if current.index and self.path and self.path.is_file() and 0<self.path.stat().st_size<=40_000_000:
    self.bytes+=self.path.stat().st_size
    info={'path':self.path,'duration':round(current.index/FPS,3),'startedAt':started,'partial':self.partial,'reason':self.reason}
    if self.on_part:
     info['part']=self.parts;self.on_part(info)
    self.parts+=1;self.info=info
  try:
   while not self.stop.is_set():
    with self.lock:data=self.latest
    if not self.active.is_set() or not data:self.stop.wait(.05);next_frame=time.monotonic();continue
    if self.frames>=FPS*MAX_RECORDING_SECONDS or self.bytes+(self.path.stat().st_size if encoder and self.path else 0)>MAX_RECORDING_BYTES:
     self.partial=True;self.reason='recording_limit';break
    if encoder is None:
     from .video_encoder import RecordingEncoder
     file=tempfile.NamedTemporaryFile(prefix='cyberapply-run-',suffix='.mp4',delete=False);self.path=Path(file.name);file.close()
     encoder=RecordingEncoder(self.path);started=datetime.now(timezone.utc).isoformat();next_frame=time.monotonic()
    delay=next_frame-time.monotonic()
    if delay>0:self.stop.wait(min(delay,.125));continue
    encoder.add(base64.b64decode(data,validate=True));self.frames+=1;next_frame=max(next_frame+1/FPS,time.monotonic()-.25)
    if self.on_part and encoder.index>=FPS*(min(2,CHECKPOINT_SECONDS) if self.parts==0 else CHECKPOINT_SECONDS):finish_part()
   with self.lock:final=self.final
   if encoder and final and not self.partial:encoder.add(base64.b64decode(final,validate=True));self.frames+=1
  except Exception:self.partial=True;self.reason='capture_interrupted';self.error='Recording capture could not finish.'
  finally:
   try:finish_part()
   except Exception:self.error='Recording could not be finalized.';self.partial=True;self.reason='capture_interrupted'
   if self.on_part or self.discard.is_set() or not self.info:self.cleanup()
 def finish(self):
  self.stop.set();self.thread.join(timeout=10)
  if self.thread.is_alive():self.discard.set();return None
  return self.info
 def cleanup(self):
  self.discard.set()
  if self.path:
   try:self.path.unlink(missing_ok=True)
   except OSError:pass
