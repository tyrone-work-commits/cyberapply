import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {files,identity,load,response,failure,type Identity,type Snapshot} from './cyber-store';
import {DomainError,type ApplicationRequest,type Job} from './cyber-domain';
import {recordingPrefix} from './application-recordings';
import {watchStorageKeys} from './agent-watch-storage';
import {applicationEmployerLink} from './application-employer-link';

export type PrivateVideoRow={owner_id:string;request_id:string;title:string;company:string;last_claim:string|null;claim_at:string|null;created_at:string;updated_at:string;application_deleted:number;state:'saved'|'deleting'|'deleted'};
const idSchema=z.string().min(1).max(300);
const detailsSchema=z.object({action:z.literal('save_details'),id:idSchema,title:z.string().trim().min(1).max(500),company:z.string().trim().min(1).max(300)}).strict();
function db(){if(!env.DB)throw new DomainError('Private video storage is unavailable.',503);return env.DB;}
export const privateVideoRow=(owner:string,id:string)=>db().prepare('SELECT * FROM cyber_private_videos WHERE owner_id=? AND request_id=?').bind(owner,id).first<PrivateVideoRow>();
export async function assertPrivateVideoAvailable(owner:string,id:string){const row=await privateVideoRow(owner,id);if(row&&row.state!=='saved')throw new DomainError('This private video was deleted or is being deleted.',410);return row;}
/** Preserve the vacancy identity when recording starts, independently of later job/application edits. */
export async function rememberPrivateVideoTitle(user:Identity,id:string,current:Snapshot){
 const item=[...(current.state.applications||[]),...(current.state.applicationArchive?.applications||[])].find(a=>a.id===id),job=current.state.jobs.find(j=>j.id===item?.jobId);
 if(!item||!job)return;
 const row=await privateVideoRow(user.userId,id);if(row?.state==='saved'&&row.title&&row.company)return;
 await db().prepare("INSERT INTO cyber_private_videos(owner_id,request_id,title,company,last_claim,claim_at,created_at,updated_at,application_deleted,state) SELECT ?,?,?,?,?,?,?,?,0,'saved' WHERE EXISTS (SELECT 1 FROM cyber_workspaces WHERE owner_id=? AND revision=? AND json_extract(payload,'$.__deleting') IS NULL) ON CONFLICT(owner_id,request_id) DO NOTHING").bind(user.userId,id,job.title,job.company,item.claim?.id||null,item.claim?.at||null,item.at,new Date().toISOString(),user.userId,current.revision).run();
}
export async function privateVideoContext(user:Identity,id:string,library=false,loaded?:Snapshot){
 const current=loaded||await load(user),row=await assertPrivateVideoAvailable(user.userId,id);
 const item=[...(current.state.applications||[]),...(current.state.applicationArchive?.applications||[])].find(a=>a.id===id&&a.agentVersion===2),job=current.state.jobs.find(j=>j.id===item?.jobId);
 if(!item&&!library)throw new DomainError('This application is not in your workspace.',404);
 if(!item&&!row){const existing=await files().list({prefix:recordingPrefix(user.userId,id),limit:1});if(!existing.objects.length)throw new DomainError('No owned private video was found.',404);}
 return {current,item,row,claimId:item?(item.claim?.id||null):(row?.last_claim||null),status:item?.status||'archived',updatedAt:item?.result?.at||row?.updated_at||item?.at||new Date(0).toISOString(),employer:{title:row?.title||job?.title||'Job title unavailable',company:row?.company||job?.company||'Employer unavailable',url:item?applicationEmployerLink(item,job):null}};
}
/** Media-only continuation can finish uploading after record deletion, for the original claim only. */
export async function privateVideoWorkerItem(user:Identity,id:string,loaded:Snapshot){
 await assertPrivateVideoAvailable(user.userId,id);
 const item=[...(loaded.state.applications||[]),...(loaded.state.applicationArchive?.applications||[])].find(a=>a.id===id&&a.agentVersion===2);
 if(item)return item;
 const row=await privateVideoRow(user.userId,id);
 if(!row||row.state!=='saved'||!row.last_claim||!row.claim_at)throw new DomainError('This recording does not belong to an owned application run.',404);
 return {status:'archived',claim:{id:row.last_claim,at:row.claim_at}};
}

async function cleanDeletedVideo(owner:string,id:string,budget:{remaining:number}){
 const row=await privateVideoRow(owner,id);if(!row||row.state==='deleted')return true;
 if(row.state!=='deleting')throw new DomainError('Confirm video deletion first.',409);
 if(budget.remaining<2)return false;
 await files().delete(watchStorageKeys(owner,id).all);budget.remaining--;
 while(budget.remaining>0){
  const page=await files().list({prefix:recordingPrefix(owner,id),limit:1000});budget.remaining--;
  if(!page.objects.length){await db().prepare("UPDATE cyber_private_videos SET state='deleted',title='',company='',last_claim=NULL,claim_at=NULL,updated_at=? WHERE owner_id=? AND request_id=? AND state='deleting'").bind(new Date().toISOString(),owner,id).run();return true;}
  if(budget.remaining<1)return false;
  await files().delete(page.objects.map(o=>o.key));budget.remaining--;
 }
 return false;
}

export async function privateVideos(request:Request){try{
 const user=await identity(request),current=await load(user),url=new URL(request.url);
 if(request.method==='GET'){
  const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2000)throw new DomainError('Invalid private video cursor.');
  const prefix=`owners/${encodeURIComponent(user.userId)}/application-recordings/`;
  const page=await files().list({prefix,delimiter:'/',limit:30,cursor});
  const rows=await db().prepare('SELECT * FROM cyber_private_videos WHERE owner_id=?').bind(user.userId).all<PrivateVideoRow>(),byId=new Map(rows.results.map(r=>[r.request_id,r]));
  const applications=[...(current.state.applications||[]),...(current.state.applicationArchive?.applications||[])];
  const describe=(id:string)=>{const a=applications.find(a=>a.id===id),job=current.state.jobs.find(j=>j.id===a?.jobId),row=byId.get(id);return {id,title:row?.title||job?.title||'Job title unavailable',company:row?.company||job?.company||'Employer unavailable',createdAt:a?.at||row?.created_at||null,applicationDeleted:!a,state:row?.state||'saved',live:!!a&&['queued','processing'].includes(a.status)};};
  const recorded=page.delimitedPrefixes.map(p=>{const encoded=p.slice(prefix.length,-1);try{const id=decodeURIComponent(encoded);return encodeURIComponent(id)===encoded&&id.length<=300?id:'';}catch{return '';}}).filter(Boolean).filter(id=>byId.get(id)?.state!=='deleted').map(describe);
  const live=cursor?[]:applications.filter(a=>a.agentVersion===2&&['queued','processing'].includes(a.status)&&(!byId.has(a.id)||byId.get(a.id)?.state==='saved')).map(a=>describe(a.id));
  const pending=cursor?[]:rows.results.filter(r=>r.state==='deleting'&&!recorded.some(v=>v.id===r.request_id)).map(r=>describe(r.request_id));
  return response({live,recorded:[...recorded,...pending],nextCursor:page.truncated?page.cursor:null});
 }
 const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new DomainError('Cross-origin writes are not allowed.',403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 const raw=await request.text();if(raw.length>12000)throw new DomainError('Too many selected videos.',413);
 let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
 if(decoded&&typeof decoded==='object'&&'action' in decoded){
  const parsed=detailsSchema.safeParse(decoded);if(!parsed.success)throw new DomainError('Provide the original job title and employer, within the supported length.');const body=parsed.data,context=await privateVideoContext(user,body.id,true,current),now=new Date().toISOString();
  const saved=await db().prepare("INSERT INTO cyber_private_videos(owner_id,request_id,title,company,last_claim,claim_at,created_at,updated_at,application_deleted,state) SELECT ?,?,?,?,?,?,?,?,?,'saved' WHERE EXISTS (SELECT 1 FROM cyber_workspaces WHERE owner_id=? AND revision=? AND json_extract(payload,'$.__deleting') IS NULL) ON CONFLICT(owner_id,request_id) DO UPDATE SET title=excluded.title,company=excluded.company,updated_at=excluded.updated_at WHERE cyber_private_videos.state='saved'").bind(user.userId,body.id,body.title,body.company,context.claimId,context.item?.claim?.at||context.row?.claim_at||null,context.row?.created_at||context.item?.at||now,now,context.item?0:1,user.userId,current.revision).run();
  if(saved.meta.changes!==1)throw new DomainError('The recording or workspace changed. Refresh before saving its details.',409);
  return response({saved:true});
 }
 const parsed=z.object({ids:z.array(idSchema).min(1).max(25),confirmation:z.literal('DELETE PRIVATE VIDEOS')}).strict().safeParse(decoded);if(!parsed.success)throw new DomainError('Select up to 25 videos and type DELETE PRIVATE VIDEOS to confirm.');const body=parsed.data;
 const ids=[...new Set(body.ids)];
 // Validate the entire selection before journaling any deletion.
 const contexts:Array<{id:string;row:PrivateVideoRow|null;context?:Awaited<ReturnType<typeof privateVideoContext>>}>=[];
 for(const id of ids){const row=await privateVideoRow(user.userId,id);if(row&&row.state!=='saved'){contexts.push({id,row});continue;}const context=await privateVideoContext(user,id,true,current);contexts.push({id,row:context.row,context});}
 const now=new Date().toISOString();
 const results=await db().batch(contexts.map(({id,row,context})=>db().prepare("INSERT INTO cyber_private_videos(owner_id,request_id,title,company,last_claim,claim_at,created_at,updated_at,application_deleted,state) SELECT ?,?,?,?,?,?,?,?,?,'deleting' WHERE EXISTS (SELECT 1 FROM cyber_workspaces WHERE owner_id=? AND revision=? AND json_extract(payload,'$.__deleting') IS NULL) ON CONFLICT(owner_id,request_id) DO UPDATE SET state=CASE WHEN cyber_private_videos.state='deleted' THEN 'deleted' ELSE 'deleting' END,updated_at=excluded.updated_at").bind(user.userId,id,context?.employer.title||row?.title||'',context?.employer.company||row?.company||'',context?.claimId||row?.last_claim||null,context?.item?.claim?.at||row?.claim_at||null,row?.created_at||context?.item?.at||now,now,context?.item?0:1,user.userId,current.revision)));
 if(results.some(result=>result.meta.changes!==1))throw new DomainError('Your workspace changed. Refresh the video library before deleting.',409);
 const deletedIds:string[]=[],pendingIds:string[]=[],budget={remaining:20};
 for(const id of ids){try{(await cleanDeletedVideo(user.userId,id,budget)?deletedIds:pendingIds).push(id);}catch{pendingIds.push(id);}}
 return response({deletedIds,pendingIds});
}catch(error){return failure(error);}}
