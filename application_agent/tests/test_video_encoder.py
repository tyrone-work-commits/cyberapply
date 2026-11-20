import io,unittest
from fractions import Fraction
import av
from application_agent.video_encoder import VideoEncoder

def jpeg(red=50):
 frame=av.VideoFrame(320,180,'rgb24');frame.planes[0].update(bytes([red,40,100])*320*180)
 codec=av.CodecContext.create('mjpeg','w');codec.width=320;codec.height=180;codec.pix_fmt='yuvj420p';codec.time_base=Fraction(1,8)
 return b''.join(bytes(packet) for packet in codec.encode(frame.reformat(format='yuvj420p')))

class VideoEncoderTests(unittest.TestCase):
 def test_fragmented_stream_decodes_as_continuous_h264_video(self):
  encoder=VideoEncoder();events=[]
  for index in range(24):events.extend(encoder.add(jpeg(30+index*5)))
  events.extend(encoder.close());self.assertEqual(events[0]['kind'],'init');segments=[e for e in events if e['kind']=='segment'];self.assertGreaterEqual(len(segments),3)
  self.assertEqual([e['sequence'] for e in segments],list(range(len(segments))));self.assertTrue(all(e['mimeCodec'].startswith('video/mp4; codecs="avc1.') for e in events))
  stream=av.open(io.BytesIO(b''.join(e['bytes'] for e in events)));frames=list(stream.decode(video=0));self.assertEqual(len(frames),24);self.assertEqual(stream.streams.video[0].codec_context.name,'h264');self.assertEqual(frames[-1].width,960)
  self.assertTrue(all(frames[i].pts<frames[i+1].pts for i in range(len(frames)-1)))
 def test_late_join_starts_at_an_independent_video_fragment(self):
  encoder=VideoEncoder();events=[]
  for _ in range(32):events.extend(encoder.add(jpeg()))
  events.extend(encoder.close());init=events[0]['bytes'];segments=[e['bytes'] for e in events if e['kind']=='segment'];joined=av.open(io.BytesIO(init+b''.join(segments[-2:])));self.assertGreaterEqual(len(list(joined.decode(video=0))),8)
