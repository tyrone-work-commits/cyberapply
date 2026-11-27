import {privateVideoContext} from './private-videos';
import {files,load,type Identity} from './cyber-store';
import {DomainError} from './cyber-domain';
import {recordingPrefix,recordingStatusKey} from './application-recordings';
import {recordingFragment,type RecordingFormat} from './recording-fragments';

// Stream one MP4 to the browser/download manager, retaining only one bounded
// checkpoint at a time. No complete-video Blob or accumulated-size cutoff.
export async function downloadApplicationRecording(request:Request,user:Identity,id:string,library=false){
 const owned=()=>privateVideoContext(user,id,library);
 const context=await owned();
 if(!library){
  if(!['applied','failed'].includes(context.status))throw new DomainError('The application process has not finished. Use Watch Live for work in progress.',409);
  const capture=context.claimId?await files().get(recordingStatusKey(user.userId,id,context.claimId)):null;
  const status=capture?await capture.json<{state:string}>():null;
  if(status&&['capturing','upload_pending'].includes(status.state))throw new DomainError('The recording is still being saved. Try again after the upload finishes.',409);
 }
 const prefix=recordingPrefix(user.userId,id),groups=new Map<string,Array<{key:string;part:number|null;duration:number;started:string;size:number}>>();
 let cursor:string|undefined;const cursors=new Set<string>();
 do{
  const options={prefix,limit:1000,cursor,include:['customMetadata']};const page=await files().list(options);
  for(const object of page.objects){
   const name=object.key.slice(prefix.length),match=/^([0-9a-f-]{36})(?:-part-(\d{3,16}))?\.mp4$/.exec(name);if(!match)continue;
   const duration=Number(object.customMetadata?.duration),part=match[2]===undefined?null:Number(match[2]);
   if(!Number.isFinite(duration)||duration<=0||object.size>40_000_000||part!==null&&!Number.isSafeInteger(part))throw new DomainError('The recording index contains an invalid checkpoint.',409);
   const group=groups.get(match[1])||[];group.push({key:object.key,part,duration,started:object.customMetadata?.startedAt||'',size:object.size});groups.set(match[1],group);
  }
  cursor=page.truncated?page.cursor:undefined;if(cursor){if(cursors.has(cursor))throw new DomainError('The recording index did not advance.',409);cursors.add(cursor);}
 }while(cursor);
 const attempts=[...groups.values()].sort((a,b)=>a[0].started.localeCompare(b[0].started));
 const parts=attempts.flatMap(group=>{const full=group.find(p=>p.part===null);return full?[full]:group.sort((a,b)=>a.part!-b.part!);});
 if(!parts.length)throw new DomainError('No recording was captured for this application.',404);
 const total=parts.reduce((n,p)=>n+p.duration,0);
 const name=('CyberApply-'+[context.employer.company,context.employer.title].filter(Boolean).join('-')).replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,140)+'.mp4';
 const headers={'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
 if(request.method==='HEAD')return new Response(null,{headers});
 async function* chunks(){
  let start=0,sequence=0,format:RecordingFormat|undefined;
  for(const part of parts){
   request.signal.throwIfAborted();await owned();const object=await files().get(part.key);if(!object)throw Error('A recording checkpoint is no longer available.');
   const fragment=recordingFragment(await object.arrayBuffer(),start,total,sequence,format);
   if(Math.abs(fragment.duration-part.duration)>.25)throw Error('The recording checkpoint duration is invalid.');
   if(!format)yield new Uint8Array(fragment.init);format=fragment.format;sequence=fragment.sequence;start+=fragment.duration;
   yield new Uint8Array(fragment.media);
  }
 }
 const iterator=chunks();
 return new Response(new ReadableStream<Uint8Array>({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(){await iterator.return();}}),{headers});
}
