"""Read-only encoded video from the agent browser; no control or cookie relay."""
import base64
from collections import deque
import threading
import time
from uuid import uuid4

class LiveWatch:
 def __init__(self,call,request_id,claim_id,interval=1.5,record=False,on_part=None):
  self.call=call;self.ids={'requestId':request_id,'claimId':claim_id};self.interval=interval
  self.stop_event=threading.Event();self.watching=threading.Event();self.reset=threading.Event();self.active=threading.Event()
  self.lock=threading.Lock();self.latest=None;self.session=None;self.last_capture=0;self.queue=deque();self.generation=0
  self.recording=None;self.recording_info=None
  if record:
   try:
    from .recording import ApplicationRecording
    self.recording=ApplicationRecording(on_part=on_part)
   except Exception:pass
  self.thread=threading.Thread(target=self._upload,name='CyberApply video upload',daemon=True)
  self.encoder_thread=threading.Thread(target=self._encode,name='CyberApply video encoder',daemon=True)
  self.thread.start();self.encoder_thread.start()
 def attach(self,context,page):
  self.detach()
  try:
   session=context.new_cdp_session(page);self.session=session
   def frame(event):
    try:session.send('Page.screencastFrameAck',{'sessionId':event['sessionId']})
    except Exception:return
    data=event.get('data','')
    if self.session is session and (self.watching.is_set() or self.recording) and isinstance(data,str) and 0<len(data)<=320000:
     with self.lock:self.latest=data
     if self.recording:self.recording.offer(data)
   session.on('Page.screencastFrame',frame)
   session.send('Page.startScreencast',{'format':'jpeg','quality':65,'maxWidth':1280,'maxHeight':720,'everyNthFrame':1})
   self.active.set()
   if self.recording:self.recording.set_active(True)
  except Exception:self.detach()
 def detach(self):
  self.active.clear();self.reset.set()
  if self.recording:self.recording.set_active(False)
  if self.session:
   try:self.session.send('Page.stopScreencast')
   except Exception:pass
   try:self.session.detach()
   except Exception:pass
   self.session=None
  with self.lock:self.latest=None;self.generation+=1
 def capture(self,force=False):
  if not self.session or not (self.watching.is_set() or self.recording) or not force and time.monotonic()-self.last_capture<.5:return
  self.last_capture=time.monotonic()
  try:
   data=self.session.send('Page.captureScreenshot',{'format':'jpeg','quality':65})['data']
   if len(data)<=320000:
    with self.lock:self.latest=data
    if self.recording:self.recording.offer(data)
  except Exception:pass
 def finish_capture(self):
  self.capture(force=True)
  if self.recording:
   with self.lock:data=self.latest
   self.recording.finish_capture(data)
 def _encode(self):
  encoder=None;generation=-1;stream_id='';next_frame=0
  while not self.stop_event.is_set():
   try:
    with self.lock:jpeg=self.latest;current=self.generation
    if self.reset.is_set() or current!=generation or not self.watching.is_set() or not self.active.is_set():
     if encoder:
      try:encoder.close()
      except Exception:pass
     encoder=None;generation=current;self.reset.clear()
     with self.lock:self.queue.clear()
    if not jpeg or not self.watching.is_set() or not self.active.is_set():self.stop_event.wait(.1);continue
    if encoder is None:
     from .video_encoder import VideoEncoder,FPS
     encoder=VideoEncoder();stream_id=str(uuid4());next_frame=time.monotonic()
    delay=next_frame-time.monotonic()
    if delay>0:self.stop_event.wait(min(delay,.125));continue
    # Repeat the current browser frame between paints to maintain video timing.
    events=encoder.add(base64.b64decode(jpeg,validate=True));next_frame=max(next_frame+1/FPS,time.monotonic()-.25)
    with self.lock:
     if len(self.queue)+len(events)>4:self.reset.set()
     else:
      for event in events:self.queue.append({**self.ids,'protocol':2,'video':{'streamId':stream_id,'kind':event['kind'],'sequence':event['sequence'],'mimeCodec':event['mimeCodec'],'data':base64.b64encode(event['bytes']).decode()}})
   except Exception:
    self.reset.set();self.stop_event.wait(1)
  if encoder:
   try:encoder.close()
   except Exception:pass
 def _upload(self):
  last_poll=0
  while not self.stop_event.is_set():
   try:
    with self.lock:body=self.queue.popleft() if self.queue and self.watching.is_set() else None
    if body is None and time.monotonic()-last_poll<self.interval:self.stop_event.wait(.05);continue
    reply=self.call(body or {**self.ids,'protocol':2});last_poll=time.monotonic()
    if reply.get('watching') is True:self.watching.set()
    else:self.watching.clear();self.reset.set()
   except Exception:self.watching.clear();self.reset.set();self.stop_event.wait(.5)
 def close(self):
  self.stop_event.set();self.encoder_thread.join(timeout=3);self.thread.join(timeout=5)
  if self.recording:self.recording_info=self.recording.finish()
  try:self.call({**self.ids,'stop':True,'protocol':2})
  except Exception:pass
 def cleanup_recording(self):
  if self.recording:self.recording.cleanup()
