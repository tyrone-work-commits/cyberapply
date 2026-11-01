import {recordingPrefix,recordingKey,recordingRange,MAX_RECORDING_SIZE} from './application-recordings';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { DomainError, record, type State } from './cyber-domain';
import { identity, load, save, files, response, failure, type Identity } from './cyber-store';
import { activeClaim, claimApplication, completeApplication, assertApplicationProfileCurrent } from './application-agent-state';
import { runnerPresence, type PresenceRow } from './agent-presence';
import {watchStorageKeys,VIDEO_SLOTS} from './agent-watch-storage';
import { extractResume } from './resume-extraction';

const digest=async(value:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=(token:string)=>digest(new TextEncoder().encode(token));
async function json(request:Request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
  const raw=await request.text();if(raw.length>65_000)throw new DomainError('Agent report is too large.',413);
  try{return JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
}
function sameOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);}
function presenceDb(){if(!env.DB)throw new DomainError('Background status storage is unavailable.',503);return env.DB;}
async function worker(request:Request){
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const match=/^ca2\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if(!match)throw new DomainError('A new application-agent token is required.',401);
  let owner:string;try{owner=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(match[1].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));}catch{throw new DomainError('Invalid agent token.',401);}
  if(owner.length>300)throw new DomainError('Invalid agent token.',401);
  // Do not create a workspace from an untrusted token.
  const row=await env.DB?.prepare('SELECT payload FROM cyber_workspaces WHERE owner_id=?').bind(owner).first<{payload:string}>();
  if(!row)throw new DomainError('Agent connection not found.',401);
  const config=JSON.parse(row.payload).newApplicationAgent;
  if(!config?.enabled||Date.parse(config.expiresAt)<=Date.now()||config.tokenHash!==await hash(token))throw new DomainError('Agent connection expired or was revoked.',401);
  return {userId:owner,email:'',displayName:'Application agent',agentHash:await hash(token)};
}
function stillConnected(state:State,user:Identity&{agentHash:string}){
  const config=state.newApplicationAgent;
  if(!config?.enabled||config.tokenHash!==user.agentHash||Date.parse(config.expiresAt)<=Date.now())throw new DomainError('Agent connection expired or was revoked.',401);
}
async function original(user:Identity&{agentHash:string},requestId:string,claimId:string){
  const current=await load(user);stillConnected(current.state,user);
  const item=activeClaim(current.state,requestId,claimId),file=current.state.attachments.find(file=>file.id===item.cv!.fileId)!;
  assertApplicationProfileCurrent(current.state,item);
  const object=await files().get(file.key);if(!object)throw new DomainError('The chosen CV file is unavailable.',409);
  const bytes=new Uint8Array(await object.arrayBuffer());if(await digest(bytes)!==item.cvSha256)throw new DomainError('The selected CV content changed.',409);
  const latest=await load(user);stillConnected(latest.state,user);assertApplicationProfileCurrent(latest.state,activeClaim(latest.state,requestId,claimId));
  return {current,item,file,bytes};
}
const claimBody=z.object({requestId:z.string().max(300),claimId:z.string().uuid()}).strict();
const resultBody=claimBody.extend({status:z.enum(['applied','needs_attention','uncertain','failed']),message:z.string().trim().min(1).max(1500),receipt:z.string().max(1500).optional(),evidence:z.object({url:z.string().max(2000),text:z.string().trim().min(1).max(3000)}).strict().optional(),report:z.record(z.string(),z.unknown()).optional()}).strict();

export async function pair(request:Request){try{
  const user=await identity(request),current=await load(user),config=current.state.newApplicationAgent;
  if(request.method==='GET'){const presence=config?.enabled?await presenceDb().prepare('SELECT token_hash,state,seen_at FROM cyber_agent_presence WHERE owner_id=?').bind(user.userId).first<PresenceRow>():null;return response({revision:current.revision,connected:!!config?.enabled&&Date.parse(config.expiresAt)>Date.now(),enabled:config?.enabled||false,expiresAt:config?.expiresAt,lastSeenAt:config?.lastSeenAt,...runnerPresence(config,presence)});}
  sameOrigin(request);
  if(request.method==='DELETE'){
    delete current.state.newApplicationAgent;
    for(const item of current.state.applications||[])if(item.agentVersion===2&&['queued','processing'].includes(item.status)){item.status=item.status==='processing'?'uncertain':'needs_action';item.result={at:new Date().toISOString(),message:'Agent disconnected. Check any in-progress employer outcome before retrying.'};}
    record(current.state,'disconnect_application_agent','Disconnected the CV application agent.','interface');
    await save(user,current.revision,current.state,'disconnect_application_agent');return response({connected:false,enabled:false});
  }
  const body=z.object({revision:z.number().int().optional(),enabled:z.literal(true),confirmation:z.literal('AUTHORIZE_CV_APPLICATIONS')}).strict().parse(await json(request));
  if(body.revision!==undefined&&body.revision!==current.revision)throw new DomainError('Reload Settings before reconnecting.',409);
  if(current.state.applications?.some(item=>item.agentVersion===2&&item.status==='processing'))throw new DomainError('Disconnect and check the in-progress application before creating another connection.',409);
  const owner=btoa(String.fromCharCode(...new TextEncoder().encode(user.userId))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const token=`ca2.${owner}.${Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')}`;
  const at=new Date().toISOString(),expiresAt=new Date(Date.now()+30*86400_000).toISOString();
  current.state.newApplicationAgent={enabled:true,tokenHash:await hash(token),issuedAt:at,expiresAt};
  record(current.state,'connect_application_agent','Enabled the CV application agent for future Apply swipes.','interface',at);
  await save(user,current.revision,current.state,'connect_application_agent');
  const serviceToken=(env as unknown as Record<string,string|undefined>).APPLICATION_AGENT_SITE_ACCESS;
  // This one-time connection package is returned only to the authenticated owner.
  // Neither credential is written to workspace history or bundled in client code.
  const connection=JSON.stringify({token,site:new URL(request.url).origin,...(serviceToken?{serviceToken}:{})});
  return response({token:connection,expiresAt,connected:true,enabled:true});
}catch(error){return failure(error);}}

export async function claim(request:Request){try{
  const user=await worker(request);const capability=await json(request);if(capability?.profileAnswersVersion!==4)throw new DomainError('Update the browser runner: Ireland eligibility, names and residence must use the current Edit Profile policy.',409);
  for(let attempt=0;attempt<3;attempt++){
    const current=await load(user);stillConnected(current.state,user);const before=JSON.stringify(current.state),item=claimApplication(current.state);
    if(!item&&JSON.stringify(current.state)===before)return response({task:null});
    current.state.newApplicationAgent!.lastSeenAt=new Date().toISOString();
    let task:unknown=null;
    if(item){
      const file=current.state.attachments.find(file=>file.id===item.cv!.fileId)!,job=current.state.jobs.find(job=>job.id===item.jobId)!;
      try{
        const object=await files().get(file.key);if(!object)throw new Error('missing');
        const bytes=new Uint8Array(await object.arrayBuffer()),extracted=await extractResume(bytes,file.name);
        item.cvSha256=await digest(bytes);
        task={requestId:item.id,claimId:item.claim!.id,profileAnswersVersion:4,applicantProfile:item.applicantProfile,job:{id:job.id,title:job.title,company:job.company,description:job.description,url:job.url,applyUrl:job.applyUrl,location:job.location,source:job.source},cv:{id:file.id,name:file.name,type:file.type,sha256:item.cvSha256,text:extracted.text},confirmedAnswers:item.confirmedAnswers||[],expiresAt:item.claim!.expiresAt};
      }catch{item.status='needs_attention';item.result={at:new Date().toISOString(),message:'The chosen CV could not be read. Select a readable CV and update the request.'};}
    }
    try{await save(user,current.revision,current.state,'application_agent_claim');return response({task});}catch(error){if(error instanceof DomainError&&error.status===409)continue;throw error;}
  }
  throw new DomainError('Workspace is changing. Wait before checking the queue again.',409);
}catch(error){return failure(error);}}
export async function cv(request:Request){try{
  const user=await worker(request),params=new URL(request.url).searchParams,body=claimBody.parse({requestId:params.get('requestId'),claimId:params.get('claimId')});
  const {bytes,file}=await original(user,body.requestId,body.claimId);
  return new Response(bytes,{headers:{'Content-Type':file.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}catch(error){return failure(error);}}
export async function authorize(request:Request){try{
  const user=await worker(request),body=claimBody.parse(await json(request));await original(user,body.requestId,body.claimId);return response({authorized:true});
}catch(error){return failure(error);}}
export async function result(request:Request){try{
  const user=await worker(request),body=resultBody.parse(await json(request));
  for(let attempt=0;attempt<3;attempt++){
    const current=await load(user);stillConnected(current.state,user);completeApplication(current.state,body);
    try{await save(user,current.revision,current.state,'application_agent_result');return response({recorded:true});}catch(error){if(error instanceof DomainError&&error.status===409)continue;throw error;}
  }
  throw new DomainError('Outcome was not saved. Check the employer; do not resubmit.',409);
}catch(error){return failure(error);}}

export async function heartbeat(request:Request){try{
 const user=await worker(request),body=z.object({state:z.enum(['checking','running','working','reconnect_required','waiting_for_connection','needs_review','stopped'])}).strict().parse(await json(request));
 const current=await load(user);stillConnected(current.state,user);
 const at=new Date().toISOString();
 await presenceDb().prepare('INSERT INTO cyber_agent_presence (owner_id,token_hash,state,seen_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash,state=excluded.state,seen_at=excluded.seen_at').bind(user.userId,user.agentHash,body.state,at).run();
 return response({received:true,at});
}catch(error){return failure(error);}}

// Read-only H.264 video uses a bounded private ring, outside workspace history.
type VideoManifest={claimId:string;streamId:string;mimeCodec:string;oldest:number;latest:number;at:number};
const watchId=z.string().min(1).max(300);
const codec=z.string().regex(/^video\/mp4; codecs="avc1\.[0-9A-Fa-f]{6}"$/);
async function watchItem(user:Identity,id:string){
 const current=await load(user),item=current.state.applications?.find(item=>item.id===id);
 if(!item)throw new DomainError('This application is not in your workspace.',404);
 return {current,item};
}
async function watchLease(owner:string,id:string){
 const stored=await files().get(watchStorageKeys(owner,id).lease);
 return stored?await stored.json<{expiresAt:number;claimId:string|null;protocol:number}>():null;
}
export async function watchViewer(request:Request){try{
 if(request.method==='POST')z.object({}).strict().parse(await json(request));
 const user=await identity(request),url=new URL(request.url),id=watchId.parse(url.searchParams.get('requestId'));
 const {current,item}=await watchItem(user,id),keys=watchStorageKeys(user.userId,id);
 const active=item.status==='queued'||item.status==='processing'&&!!item.claim&&Date.parse(item.claim.expiresAt)>Date.now();
 if(request.method==='POST'){
  sameOrigin(request);
  if(active)await files().put(keys.lease,JSON.stringify({expiresAt:Date.now()+20000,claimId:item.status==='processing'?item.claim?.id:null,protocol:2}));
  else await files().delete(keys.all);
  const job=current.state.jobs.find(job=>job.id===item.jobId);
  return response({active,status:item.status,title:job?.title||'Application',company:job?.company||'',message:active?(item.status==='queued'?'Waiting for the background agent to pick up this request.':'Connecting to the agent’s live video…'):'The agent is no longer working on this request. Viewing does not restart it.'});
 }
 const empty=()=>new Response(null,{status:204,headers:{'Cache-Control':'private, no-store'}});
 if(!active||item.status!=='processing')return empty();
 const lease=await watchLease(user.userId,id);
 if(!lease||lease.expiresAt<=Date.now()||lease.claimId!==item.claim?.id||lease.protocol!==2)return empty();
 const stored=await files().get(keys.manifest),manifest=stored?await stored.json<VideoManifest>():null;
 if(!manifest||manifest.claimId!==item.claim?.id||manifest.at<Date.now()-12000)return empty();
 const part=url.searchParams.get('part')||'manifest';
 if(part==='manifest')return response({streamId:manifest.streamId,mimeCodec:manifest.mimeCodec,oldest:manifest.oldest,latest:manifest.latest,at:manifest.at});
 if(url.searchParams.get('stream')!==manifest.streamId)return empty();
 const sequence=Number(url.searchParams.get('seq'));
 if(part!=='init'&&(part!=='segment'||!Number.isSafeInteger(sequence)||sequence<manifest.oldest||sequence>manifest.latest))return empty();
 const object=await files().get(part==='init'?keys.init:keys.segment(sequence)),meta=object?.customMetadata;
 if(!object||meta?.claimId!==item.claim?.id||meta.streamId!==manifest.streamId||part==='segment'&&meta.sequence!==String(sequence))return empty();
 const latest=await watchItem(user,id),leaseNow=await watchLease(user.userId,id);
 if(latest.item.status!=='processing'||latest.item.claim?.id!==manifest.claimId||Date.parse(latest.item.claim.expiresAt)<=Date.now()||!leaseNow||leaseNow.expiresAt<=Date.now()||leaseNow.claimId!==manifest.claimId)return empty();
 return new Response(object.body,{headers:{'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
}catch(error){return failure(error);}}
export async function watchWorker(request:Request){try{
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 if(Number(request.headers.get('content-length')||0)>710000){await request.body?.cancel();throw new DomainError('Video segment is too large.',413);}
 const raw=await request.text();if(raw.length>710000)throw new DomainError('Video segment is too large.',413);
 const user=await worker(request);let input;try{input=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
 const body=claimBody.extend({protocol:z.number().optional(),video:z.object({streamId:z.string().uuid(),kind:z.enum(['init','segment']),sequence:z.number().int().min(0).max(10000),mimeCodec:codec,data:z.string().min(1).max(700000)}).strict().optional(),stop:z.boolean().optional(),frame:z.string().max(320000).optional()}).strict().parse(input);
 const {current}=await watchItem(user,body.requestId);stillConnected(current.state,user);activeClaim(current.state,body.requestId,body.claimId);
 const keys=watchStorageKeys(user.userId,body.requestId);
 if(body.stop){await files().delete(keys.all);return response({watching:false});}
 if(body.protocol!==2)return response({watching:false,upgradeRequired:true});
 const lease=await watchLease(user.userId,body.requestId);
 if(!lease||lease.expiresAt<=Date.now()||lease.claimId!==body.claimId||lease.protocol!==2){await files().delete(keys.all.filter(key=>key!==keys.lease));return response({watching:false});}
 if(body.video){
  const video=body.video;let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(video.data),c=>c.charCodeAt(0));}catch{throw new DomainError('Invalid video segment.');}
  const box=new TextDecoder().decode(bytes.slice(4,8));if(bytes.length<16||bytes.length>500000||(video.kind==='init'?box!=='ftyp':box!=='moof'))throw new DomainError('Invalid fragmented MP4 segment.');
  const latest=await watchItem(user,body.requestId);stillConnected(latest.current.state,user);activeClaim(latest.current.state,body.requestId,body.claimId);
  const currentLease=await watchLease(user.userId,body.requestId);if(!currentLease||currentLease.expiresAt<=Date.now()||currentLease.claimId!==body.claimId||currentLease.protocol!==2)return response({watching:false});
  const now=Date.now(),metadata={claimId:body.claimId,streamId:video.streamId,sequence:String(video.sequence)};
  if(video.kind==='init'){
   if(video.sequence!==0)throw new DomainError('Invalid video initialization.');
   await files().delete(keys.all.filter(key=>key!==keys.lease));
   await files().put(keys.init,bytes,{httpMetadata:{contentType:'video/mp4'},customMetadata:metadata});
   await files().put(keys.manifest,JSON.stringify({claimId:body.claimId,streamId:video.streamId,mimeCodec:video.mimeCodec,oldest:0,latest:-1,at:now} satisfies VideoManifest));
  }else{
   const stored=await files().get(keys.manifest),manifest=stored?await stored.json<VideoManifest>():null;
   if(!manifest||manifest.streamId!==video.streamId||manifest.claimId!==body.claimId||manifest.mimeCodec!==video.mimeCodec)throw new DomainError('The video session changed. Reconnect the viewer.',409);
   if(video.sequence===manifest.latest)return response({watching:true}); // Retry of this read-only media upload.
   if(video.sequence!==manifest.latest+1)throw new DomainError('The video sequence changed. Reconnect the viewer.',409);
   await files().put(keys.segment(video.sequence),bytes,{httpMetadata:{contentType:'video/mp4'},customMetadata:metadata});
   await files().put(keys.manifest,JSON.stringify({...manifest,latest:video.sequence,oldest:Math.max(0,video.sequence-VIDEO_SLOTS+1),at:now}));
  }
 }
 return response({watching:true});
}catch(error){return failure(error);}}

function recordingOwnerItem(state:State,id:string){
 const item=[...(state.applications||[]),...(state.applicationArchive?.applications||[])].find(item=>item.id===id&&item.agentVersion===2);
 if(!item)throw new DomainError('This application is not in your workspace.',404);return item;
}
export async function saveRecording(request:Request){
 let writtenKey:string|undefined;
 try{
  const user=await worker(request),url=new URL(request.url),ids=claimBody.parse({requestId:url.searchParams.get('requestId'),claimId:url.searchParams.get('claimId')});
  const current=await load(user);stillConnected(current.state,user);const item=recordingOwnerItem(current.state,ids.requestId);
  if(item.claim?.id!==ids.claimId||item.status==='queued'||!Number.isFinite(Date.parse(item.claim.at))||Date.parse(item.claim.at)<Date.now()-3600000)throw new DomainError('This recording does not match a recent application run.',409);
  if(request.method==='GET'){const stored=await files().head(recordingKey(user.userId,ids.requestId,ids.claimId));return response({saved:!!stored,...(stored?{sha256:stored.customMetadata?.sha256}:{})});}
  if(request.headers.get('content-type')!=='video/mp4')throw new DomainError('Send an MP4 recording.',415);
  const size=Number(request.headers.get('content-length')),duration=Number(request.headers.get('x-recording-duration')),checksum=request.headers.get('x-recording-sha256')||'',started=request.headers.get('x-recording-started-at')||'',partial=request.headers.get('x-recording-partial'),reason=request.headers.get('x-recording-reason')||'';
  if(!Number.isSafeInteger(size)||size<16||size>MAX_RECORDING_SIZE)throw new DomainError('Recording must be smaller than 40 MB.',413);
  if(!Number.isFinite(duration)||duration<=0||duration>600.5||!Number.isFinite(Date.parse(started))||Date.parse(started)>Date.now()+60000||Date.parse(started)<Date.parse(item.claim.at)-60000||!['true','false'].includes(partial||'')||!['','recording_limit','capture_interrupted'].includes(reason)||!/^[a-f0-9]{64}$/.test(checksum))throw new DomainError('Invalid recording metadata.');
  const key=recordingKey(user.userId,ids.requestId,ids.claimId),prior=await files().head(key);
  if(prior){if(request.body)await request.body.pipeTo(new WritableStream({write(){}}));if(prior.customMetadata?.sha256!==checksum)throw new DomainError('A different recording is already saved for this run.',409);return response({saved:true,alreadySaved:true});}
  if(!request.body)throw new DomainError('Recording data is missing.');
  let prefix=new Uint8Array(0);
  const validate=new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){if(prefix.length<8){const next=new Uint8Array(Math.min(8,prefix.length+chunk.length));next.set(prefix);next.set(chunk.slice(0,8-prefix.length),prefix.length);prefix=next;if(prefix.length===8&&new TextDecoder().decode(prefix.slice(4,8))!=='ftyp')throw Error('Not an MP4 recording.');}controller.enqueue(chunk);},flush(){if(prefix.length<8)throw Error('Incomplete recording.');}});
  const fixed=new FixedLengthStream(size),pipe=request.body.pipeThrough(validate).pipeTo(fixed.writable),digestBytes=Uint8Array.from(checksum.match(/../g)!,value=>parseInt(value,16));
  const writing=files().put(key,fixed.readable,{sha256:digestBytes,onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'video/mp4'},customMetadata:{claimId:ids.claimId,sha256:checksum,duration:String(duration),startedAt:new Date(started).toISOString(),recordedAt:new Date().toISOString(),partial:partial!,reason}});
  const settled=await Promise.allSettled([pipe,writing]);
  if(settled.some(item=>item.status==='rejected'))throw new DomainError('Recording upload did not finish or its checksum did not match. The application outcome is unchanged.',400);
  const result=settled[1];if(result.status==='fulfilled'&&!result.value){const same=await files().head(key);if(same?.customMetadata?.sha256!==checksum)throw new DomainError('A different recording is already saved for this run.',409);return response({saved:true,alreadySaved:true});}
  writtenKey=key;
  // Do not leave a video behind if its owner/application was deleted during upload.
  const latest=await load(user);stillConnected(latest.state,user);recordingOwnerItem(latest.state,ids.requestId);
  writtenKey=undefined;return response({saved:true,attempt:ids.claimId});
 }catch(error){
  if(writtenKey)try{await files().delete(writtenKey);}catch{}
  return failure(error);
 }
}
export async function recordingViewer(request:Request){try{
 const user=await identity(request),url=new URL(request.url),id=watchId.parse(url.searchParams.get('requestId')),current=await load(user);recordingOwnerItem(current.state,id);
 const attempt=url.searchParams.get('attempt');
 if(!attempt){
  const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2000)throw new DomainError('Invalid recording cursor.');
  const prefix=recordingPrefix(user.userId,id),page=await files().list({prefix,limit:100,cursor});
  const objects=await Promise.all(page.objects.map(object=>files().head(object.key)));
  const items=objects.filter((object):object is NonNullable<typeof object>=>!!object).filter(object=>object.key.startsWith(prefix)&&/^[0-9a-f-]{36}\.mp4$/.test(object.key.slice(prefix.length))).map(object=>({attempt:object.customMetadata?.claimId,duration:Number(object.customMetadata?.duration||0),startedAt:object.customMetadata?.startedAt,recordedAt:object.customMetadata?.recordedAt,partial:object.customMetadata?.partial==='true',reason:object.customMetadata?.reason||'',size:object.size})).filter(item=>item.attempt).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
  return response({items,nextCursor:page.truncated?page.cursor:null});
 }
 z.string().uuid().parse(attempt);const key=recordingKey(user.userId,id,attempt),head=await files().head(key);if(!head)throw new DomainError('No saved recording was found for this run.',404);
 const range=recordingRange(request.headers.get('range'),head.size);
 if(range==='invalid')return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`,'Cache-Control':'private, no-store'}});
 const object=await files().get(key,range?{range}:undefined);if(!object)throw new DomainError('This recording is no longer available.',404);
 const latest=await load(user);recordingOwnerItem(latest.state,id);
 const headers=new Headers({'Content-Type':'video/mp4','Content-Length':String(range?range.length:head.size),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Disposition':'inline; filename="application-recording.mp4"'});
 if(range)headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${head.size}`);
 return new Response(request.method==='HEAD'?null:object.body,{status:range?206:200,headers});
}catch(error){return failure(error);}}
