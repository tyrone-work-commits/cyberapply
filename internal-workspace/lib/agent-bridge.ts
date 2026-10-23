import { env } from 'cloudflare:workers';
import { DomainError, type ApplicationRequest, type Job } from './cyber-domain';
import { load, save, type Identity, type Snapshot } from './cyber-store';

const noStore={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export function agentResponse(value:unknown,status=200){return Response.json(value,{status,headers:noStore});}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);}
export async function tokenHash(token:string){const bytes=new TextEncoder().encode(token);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function equal(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function createPairToken(ownerId:string){const bytes=crypto.getRandomValues(new Uint8Array(32));const secret=Array.from(bytes).map(byte=>byte.toString(16).padStart(2,'0')).join('');return `ca1.${btoa(ownerId).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}.${secret}`;}
export async function authorizeAgent(request:Request):Promise<{user:Identity;current:Snapshot}>{
 const header=request.headers.get('authorization')||'';const token=header.startsWith('Bearer ')?header.slice(7):'';
 const match=/^ca1\.([A-Za-z0-9_-]{4,200})\.([a-f0-9]{64})$/.exec(token);
 if(!match)throw new DomainError('Agent access is not paired.',401);
 let ownerId='';try{ownerId=atob(match[1].replaceAll('-','+').replaceAll('_','/'));}catch{throw new DomainError('Agent access is invalid.',401);}
 if(!ownerId||ownerId.length>150||!env.DB)throw new DomainError('Agent access is invalid.',401);
 const found=await env.DB.prepare('SELECT 1 AS found FROM cyber_workspaces WHERE owner_id=?').bind(ownerId).first();
 if(!found)throw new DomainError('Agent access is invalid.',401);
 const user={userId:ownerId,email:'',displayName:''},current=await load(user),pair=current.state.agentPairing;
 if(!pair||pair.expiresAt<=new Date().toISOString()||!equal(pair.tokenHash,await tokenHash(token)))throw new DomainError('Agent access has expired or been revoked.',401);
 return {user,current};
}
export function eligibleJob(current:Snapshot,request:ApplicationRequest):Job|undefined{
 if(request.status!=='queued'||!request.agentAuthorizedAt||request.reason!=='connection_required'||!request.candidate.reviewed||!request.cv)return;
 if(!current.state.attachments.some(file=>file.id===request.cv?.fileId))return;
 const job=current.state.jobs.find(item=>item.id===request.jobId);
 if(!job||job.source?.availability==='closed')return;
 return job;
}
export async function saveAgent(user:Identity,current:Snapshot,action:string){return save(user,current.revision,current.state,action);}
