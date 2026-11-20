import {createFile,DataStream} from 'mp4box';

// Remux our silent H.264 checkpoints without re-encoding or contacting an employer.
// One Blob gives the browser one duration and a genuinely seekable full-run timeline.
export function combineRecordingParts(parts:ArrayBuffer[]):ArrayBuffer{
 if(!parts.length||parts.length>360||parts.reduce((n,p)=>n+p.byteLength,0)>48_000_000)throw Error('This recording exceeds the playback limit.');
 const output=createFile();let trackId:number|undefined,timescale=0,cursor=0,config:Uint8Array|undefined,width=0,height=0,samples=0;
 for(const bytes of parts){
  const input=createFile(true);let parseError=false;input.onError=()=>{parseError=true;};
  input.appendBuffer(Object.assign(bytes,{fileStart:0}));input.flush();
  const info=input.getInfo(),track=info.videoTracks?.[0];
  if(parseError||!track?.video||info.tracks.length!==1||!track.codec.startsWith('avc1.')||track.nb_samples<1||track.nb_samples>4810)throw Error('A recording could not be read. Refresh recordings to try again.');
  samples+=track.nb_samples;if(samples>28810)throw Error('This recording exceeds the playback limit.');
  const first=input.getTrackSample(track.id,0),description=first?.description as {avcC?:{write(stream:DataStream):void}}|undefined;
  if(!first?.is_sync||!description?.avcC)throw Error('This recording has an unsupported video format.');
  const stream=new DataStream();description.avcC.write(stream);const decoder=new Uint8Array(stream.buffer).slice(8);
  if(trackId===undefined){
   config=decoder;timescale=track.timescale;width=track.video.width;height=track.video.height;
   trackId=output.addTrack({type:'avc1',hdlr:'vide',timescale,width,height,avcDecoderConfigRecord:decoder.buffer,brands:['isom','iso6','avc1','mp41']});
   if(trackId===undefined)throw Error('The recording timeline could not be created.');
  }else if(track.timescale!==timescale||track.video.width!==width||track.video.height!==height||decoder.length!==config!.length||decoder.some((value,index)=>value!==config![index]))throw Error('The saved video formats do not match. This recording cannot be combined.');
  let end=0;
  for(let i=0;i<track.nb_samples;i++){
   const sample=input.getTrackSample(track.id,i);
   if(!sample?.data||sample.duration<=0||sample.dts-first.dts!==end)throw Error('A recording is incomplete. Refresh recordings to try again.');
   const dts=cursor+sample.dts-first.dts;
   output.addSample(trackId,sample.data,{duration:sample.duration,dts,cts:dts+sample.cts-sample.dts,is_sync:sample.is_sync});
   end=sample.dts-first.dts+sample.duration;
  }
  cursor+=end;if(cursor/timescale>3600)throw Error('This recording exceeds the playback limit.');
 }
 const track=output.getTrackById(trackId!);output.moov.mvhd.duration=cursor;track.tkhd.duration=cursor;track.mdia.mdhd.duration=cursor;
 return output.getBuffer().buffer;
}
