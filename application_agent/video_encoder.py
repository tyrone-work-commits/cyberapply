"""In-memory H.264 fragmented-MP4 encoder for the private live browser feed."""
import io
from fractions import Fraction

FPS=8
MAX_SEGMENT=500000

class _Sink:
 def __init__(self):self.buffer=bytearray();self.position=0;self.init=bytearray();self.fragment=bytearray();self.events=[]
 def writable(self):return True
 def seekable(self):return False
 def tell(self):return self.position
 def write(self,data):
  self.position+=len(data);self.buffer.extend(data)
  if len(self.buffer)>2000000:raise ValueError('Video encoder buffer limit.')
  while len(self.buffer)>=8:
   size=int.from_bytes(self.buffer[:4],'big');kind=bytes(self.buffer[4:8])
   if size<8 or size>2000000:raise ValueError('Invalid video box.')
   if len(self.buffer)<size:break
   box=bytes(self.buffer[:size]);del self.buffer[:size]
   if kind in {b'ftyp',b'moov'}:
    self.init.extend(box)
    if kind==b'moov':self.events.append(('init',bytes(self.init)));self.init.clear()
   elif kind==b'moof':self.fragment=bytearray(box)
   elif kind==b'mdat' and self.fragment:
    self.fragment.extend(box)
    if len(self.fragment)>MAX_SEGMENT:raise ValueError('Video segment limit.')
    self.events.append(('segment',bytes(self.fragment)));self.fragment.clear()
  return len(data)
 def drain(self):result=self.events;self.events=[];return result

class VideoEncoder:
 def __init__(self):
  import av
  self.av=av;self.sink=_Sink();self.index=0;self.sequence=0;self.mime=''
  self.container=av.open(self.sink,mode='w',format='mp4',options={'movflags':'empty_moov+default_base_moof+frag_keyframe','flush_packets':'1'})
  self.stream=self.container.add_stream('libx264',rate=FPS)
  self.stream.width=960;self.stream.height=540;self.stream.pix_fmt='yuv420p'
  self.stream.codec_context.thread_count=1;self.stream.codec_context.gop_size=FPS
  self.stream.options={'preset':'ultrafast','tune':'zerolatency','profile':'baseline','level':'3.1','crf':'25','bf':'0','sc_threshold':'0'}
  self.decoder=av.CodecContext.create('mjpeg','r')
  self.container.start_encoding()
 def _events(self):
  result=[]
  for kind,data in self.sink.drain():
   if kind=='init':
    offset=data.find(b'avcC')
    if offset<0 or len(data)<offset+8:raise ValueError('Missing AVC video configuration.')
    self.mime='video/mp4; codecs="avc1.'+data[offset+5:offset+8].hex().upper()+'"'
   result.append({'kind':kind,'sequence':self.sequence if kind=='segment' else 0,'mimeCodec':self.mime,'bytes':data})
   if kind=='segment':self.sequence+=1
  return result
 def add(self,jpeg):
  frames=self.decoder.decode(self.av.Packet(jpeg))
  if not frames:return []
  frame=frames[0].reformat(width=960,height=540,format='yuv420p');frame.pict_type=self.av.video.frame.PictureType.NONE;frame.pts=self.index;frame.time_base=Fraction(1,FPS);self.index+=1
  for packet in self.stream.encode(frame):self.container.mux(packet)
  return self._events()
 def close(self):
  for packet in self.stream.encode():self.container.mux(packet)
  self.container.close()
  return self._events()


class RecordingEncoder:
 """A finalized, seekable MP4 for one run, independent of live-view leases."""
 def __init__(self,path):
  import av
  self.av=av;self.index=0
  self.container=av.open(str(path),mode='w',format='mp4',options={'movflags':'faststart'})
  self.stream=self.container.add_stream('libx264',rate=FPS)
  self.stream.width=960;self.stream.height=540;self.stream.pix_fmt='yuv420p'
  self.stream.codec_context.thread_count=1;self.stream.codec_context.gop_size=FPS
  self.stream.options={'preset':'ultrafast','tune':'zerolatency','profile':'baseline','level':'3.1','crf':'25','bf':'0','sc_threshold':'0'}
  self.decoder=av.CodecContext.create('mjpeg','r')
 def add(self,jpeg):
  frames=self.decoder.decode(self.av.Packet(jpeg))
  if not frames:return
  frame=frames[0].reformat(width=960,height=540,format='yuv420p');frame.pict_type=self.av.video.frame.PictureType.NONE;frame.pts=self.index;frame.time_base=Fraction(1,FPS);self.index+=1
  for packet in self.stream.encode(frame):self.container.mux(packet)
 def close(self):
  for packet in self.stream.encode():self.container.mux(packet)
  self.container.close()
