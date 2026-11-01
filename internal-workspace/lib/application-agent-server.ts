import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { DomainError, record, type State } from './cyber-domain';
import { identity, load, save, files, response, failure, type Identity } from './cyber-store';
import { activeClaim, claimApplication, completeApplication, assertApplicationProfileCurrent } from './application-agent-state';
import { runnerPresence, type PresenceRow } from './agent-presence';
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

// Live snapshots use existing private file storage, outside workspace history.
// A lease is renewed only by the signed-in owner while the viewer is visible.
const watchKeys=(owner:string,id:string)=>{
 const root=`owners/${encodeURIComponent(owner)}/live-watch/${encodeURIComponent(id)}`;
 return {lease:root+'/lease',frame:root+'/frame.jpg'};
};
const watchId=z.string().min(1).max(300);
async function watchItem(user:Identity,id:string){
 const current=await load(user),item=current.state.applications?.find(item=>item.id===id);
 if(!item)throw new DomainError('This application is not in your workspace.',404);
 return {current,item};
}
async function watchLease(owner:string,id:string){
 const stored=await files().get(watchKeys(owner,id).lease);
 return stored?await stored.json<{expiresAt:number;claimId:string|null}>():null;
}
export async function watchViewer(request:Request){try{
 if(request.method==='POST')z.object({}).strict().parse(await json(request));
 const user=await identity(request),url=new URL(request.url);
 const id=watchId.parse(url.searchParams.get('requestId'));
 const {current,item}=await watchItem(user,id),keys=watchKeys(user.userId,id);
 const active=item.status==='queued'||item.status==='processing'&&!!item.claim&&Date.parse(item.claim.expiresAt)>Date.now();
 if(request.method==='POST'){
  sameOrigin(request);
  if(active)await files().put(keys.lease,JSON.stringify({expiresAt:Date.now()+20000,claimId:item.status==='processing'?item.claim?.id:null}));
  else await files().delete([keys.lease,keys.frame]);
  const job=current.state.jobs.find(job=>job.id===item.jobId);
  return response({active,status:item.status,title:job?.title||'Application',company:job?.company||'',message:active?(item.status==='queued'?'Waiting for the background agent to pick up this request.':'The agent is working. Waiting for a current browser snapshot.'):'The agent is no longer working on this request. Viewing does not restart it.'});
 }
 if(!active||item.status!=='processing')return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store'}});
 const lease=await watchLease(user.userId,id);
 if(!lease||lease.expiresAt<=Date.now()||lease.claimId!==item.claim?.id)return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store'}});
 const frame=await files().get(keys.frame),meta=frame?.customMetadata;
 if(!frame||meta?.claimId!==item.claim?.id||!Number.isFinite(Number(meta.at))||Number(meta.at)<Date.now()-12000)return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store'}});
 // Recheck owner state after storage I/O; a finished/deleted request must not
 // continue serving frames from an old claim.
 const latest=await watchItem(user,id);
 if(latest.item.status!=='processing'||latest.item.claim?.id!==meta.claimId)return new Response(null,{status:204,headers:{'Cache-Control':'private, no-store'}});
 return new Response(frame.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Observed-At':meta.at,'Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin'}});
}catch(error){return failure(error);}}
export async function watchWorker(request:Request){try{
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 if(Number(request.headers.get('content-length')||0)>325000){await request.body?.cancel();throw new DomainError('Snapshot is too large.',413);}
 const raw=await request.text();if(raw.length>325000)throw new DomainError('Snapshot is too large.',413);
 const user=await worker(request);
 let input;try{input=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
 const body=claimBody.extend({frame:z.string().min(1).max(320000).optional(),stop:z.boolean().optional()}).strict().parse(input);
 const {current,item}=await watchItem(user,body.requestId);stillConnected(current.state,user);
 activeClaim(current.state,body.requestId,body.claimId);
 const keys=watchKeys(user.userId,body.requestId);
 if(body.stop){await files().delete([keys.lease,keys.frame]);return response({watching:false});}
 const lease=await watchLease(user.userId,body.requestId);
 if(!lease||lease.expiresAt<=Date.now()||lease.claimId!==body.claimId){await files().delete(keys.frame);return response({watching:false});}
 if(body.frame){
  let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(body.frame),c=>c.charCodeAt(0));}catch{throw new DomainError('Invalid JPEG snapshot.');}
  if(bytes.length>240000||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new DomainError('Invalid JPEG snapshot.');
  const latest=await watchItem(user,body.requestId);stillConnected(latest.current.state,user);activeClaim(latest.current.state,body.requestId,body.claimId);
  await files().put(keys.frame,bytes,{httpMetadata:{contentType:'image/jpeg'},customMetadata:{claimId:body.claimId,at:String(Date.now())}});
 }
 return response({watching:true});
}catch(error){return failure(error);}}
