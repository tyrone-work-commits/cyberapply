import {RecordingLoader} from './recording-loader';
import {recordingFragment,type RecordingFormat} from './recording-fragments';
export type StreamPart={url:string;start:number;duration:number};

// A small sliding browser buffer. Seeking fetches the requested checkpoints
// again; the full recording is never copied into a JavaScript Blob.
export class RecordingStream{
 readonly url:string;private media=new MediaSource();private buffer:SourceBuffer|null=null;private loader=new RecordingLoader(undefined,1);
 private parts:StreamPart[]=[];private duration=0;private format:RecordingFormat|undefined;private disposed=false;private busy=false;private again=false;private loaded=new Set<string>();
 constructor(private video:HTMLVideoElement,private error:(message:string)=>void){
  this.url=URL.createObjectURL(this.media);this.media.addEventListener('sourceopen',this.pump);video.addEventListener('timeupdate',this.pump);video.addEventListener('seeking',this.pump);
 }
 update(parts:StreamPart[],duration:number){this.parts=parts;this.duration=duration;void this.pump();}
 close(){this.disposed=true;this.loader.close();this.video.removeEventListener('timeupdate',this.pump);this.video.removeEventListener('seeking',this.pump);this.media.removeEventListener('sourceopen',this.pump);URL.revokeObjectURL(this.url);}
 private change(action:()=>void){return new Promise<void>((resolve,reject)=>{
  const buffer=this.buffer!;let timer:ReturnType<typeof setTimeout>;
  const done=()=>{clearTimeout(timer);buffer.removeEventListener('updateend',ok);buffer.removeEventListener('error',bad);};
  const ok=()=>{done();resolve();},bad=()=>{done();reject(Error('The recording buffer could not be updated.'));};
  timer=setTimeout(bad,15000);buffer.addEventListener('updateend',ok,{once:true});buffer.addEventListener('error',bad,{once:true});try{action();}catch(e){done();reject(e);}
 });}
 private pump=async()=>{
  if(this.disposed||this.media.readyState!=='open'||!this.parts.length)return;
  if(this.busy){this.again=true;return;}this.busy=true;
  try{
   const time=this.video.currentTime,wanted=this.parts.filter(part=>part.start+part.duration>Math.max(0,time-15)&&part.start<Math.min(this.duration,time+30));
   const begin=wanted[0]?.start||0,end=wanted.at(-1)?wanted.at(-1)!.start+wanted.at(-1)!.duration:this.duration;
   if(this.buffer){
    const ranges=this.buffer.buffered;
    for(let i=ranges.length-1;i>=0;i--){
     const from=ranges.start(i),to=ranges.end(i);
     if(from<begin)await this.change(()=>this.buffer!.remove(from,Math.min(to,begin)));
     if(to>end)await this.change(()=>this.buffer!.remove(Math.max(from,end),to));
    }
    for(const part of this.parts)if(part.start+part.duration<=begin||part.start>=end)this.loaded.delete(part.url);
   }
   for(const part of wanted){
    if(this.disposed)break;if(this.loaded.has(part.url))continue;
    this.loader.retain([part.url]);const bytes=await this.loader.load(part.url);if(this.disposed)break;
    const fragment=recordingFragment(bytes.slice(0),part.start,this.duration,0,this.format);
    if(Math.abs(fragment.duration-part.duration)>.25)throw Error('The recording checkpoint duration does not match its index.');
    if(!this.buffer){
     const mime='video/mp4; codecs="'+fragment.format.codec+'"';if(!MediaSource.isTypeSupported(mime))throw Error('This browser cannot play the recorded video. Download it or use an updated Chrome browser.');
     this.buffer=this.media.addSourceBuffer(mime);this.format=fragment.format;await this.change(()=>this.buffer!.appendBuffer(fragment.init));
    }
    if(this.media.duration!==this.duration)this.media.duration=this.duration;
    await this.change(()=>this.buffer!.appendBuffer(fragment.media));this.loaded.add(part.url);
    if(Math.abs(this.video.currentTime-time)>15){this.again=true;break;}
   }
  }catch(e){if(!this.disposed)this.error((e as Error).message);}
  finally{this.busy=false;if(this.again&&!this.disposed){this.again=false;queueMicrotask(()=>void this.pump());}}
 };
}
