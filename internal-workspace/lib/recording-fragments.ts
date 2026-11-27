import {createFile,DataStream} from 'mp4box';

export type RecordingFormat={codec:string;timescale:number;width:number;height:number;decoder:number[]};
// Each checkpoint is bounded, but the complete application has no duration,
// sample-count or accumulated-byte cutoff. Output can be streamed to disk/MSE.
export function recordingFragment(bytes:ArrayBuffer,start:number,total:number,sequence=0,expected?:RecordingFormat){
 if(!bytes.byteLength||bytes.byteLength>40_000_000||!Number.isFinite(start)||start<0||!Number.isFinite(total)||total<=0)throw Error('Invalid recording checkpoint.');
 const input=createFile(true);let error=false;input.onError=()=>{error=true;};
 input.appendBuffer(Object.assign(bytes,{fileStart:0}));input.flush();
 const info=input.getInfo(),track=info.videoTracks?.[0],first=track&&input.getTrackSample(track.id,0);
 const description=first?.description as {avcC?:{write(stream:DataStream):void}}|undefined;
 if(error||info.tracks?.length!==1||!track?.video||!track.codec.startsWith('avc1.')||track.nb_samples<1||track.nb_samples>4810||!first?.is_sync||!description?.avcC)throw Error('The recording checkpoint is incomplete or unsupported.');
 const decoderStream=new DataStream();description.avcC.write(decoderStream);const decoder=new Uint8Array(decoderStream.buffer).slice(8);
 const format={codec:track.codec,timescale:track.timescale,width:track.video.width,height:track.video.height,decoder:Array.from(decoder)};
 if(expected&&JSON.stringify(format)!==JSON.stringify(expected))throw Error('The recording checkpoint formats do not match.');
 const output=createFile(),id=output.addTrack({type:'avc1',hdlr:'vide',timescale:track.timescale,width:format.width,height:format.height,avcDecoderConfigRecord:decoder.buffer,brands:['isom','iso6','avc1','mp41']});
 if(id===undefined)throw Error('The recording track could not be created.');
 output.nextMoofNumber=sequence;const resultTrack=output.getTrackById(id)!;resultTrack.first_dts=0;
 let ticks=0;
 for(let index=0;index<track.nb_samples;index++){
  const sample=input.getTrackSample(track.id,index);
  if(!sample?.data||sample.duration<=0||sample.dts-first.dts!==ticks)throw Error('The recording checkpoint has missing frames.');
  const dts=Math.round(start*track.timescale)+ticks;
  output.addSample(id,sample.data,{duration:sample.duration,dts,cts:dts+sample.cts-sample.dts,is_sync:sample.is_sync});ticks+=sample.duration;
 }
 output.moov.mvhd.timescale=track.timescale;output.moov.mvhd.duration=Math.round(total*track.timescale);
 resultTrack.tkhd.duration=resultTrack.mdia.mdhd.duration=Math.round(total*track.timescale);
 const buffer=output.getBuffer().buffer,view=new DataView(buffer);let split=0;
 while(split+8<=buffer.byteLength){const size=view.getUint32(split),type=String.fromCharCode(...new Uint8Array(buffer,split+4,4));if(size<8||split+size>buffer.byteLength)throw Error('Invalid recording box.');if(type!=='ftyp'&&type!=='moov')break;split+=size;}
 if(!split||split===buffer.byteLength)throw Error('The recording checkpoint has no media.');
 return {init:buffer.slice(0,split),media:buffer.slice(split),format,duration:ticks/track.timescale,sequence:output.nextMoofNumber};
}
