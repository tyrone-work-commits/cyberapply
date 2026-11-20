import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {identity,load,response,failure} from './cyber-store';
import {DomainError} from './cyber-domain';
import {applicationWorkerIdentity} from './application-agent-server';
import {activeClaim} from './application-agent-state';
import {browserWindowState,getBrowserWindow,requestBrowserWindow,updateBrowserWindow} from './application-browser-window';
const id=z.string().min(1).max(300),uuid=z.string().uuid();
function database(){if(!env.DB)throw new DomainError('Agent browser status is unavailable.',503);return env.DB;}
async function body(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 const raw=await request.text();if(raw.length>2000)throw new DomainError('Browser command is too large.',413);try{return JSON.parse(raw);}catch{throw new DomainError('Invalid browser command.');}
}
export async function ownerBrowserWindow(request:Request){try{
 const user=await identity(request),url=new URL(request.url);
 if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new DomainError('Cross-origin writes are not allowed.',403);
 const input=request.method==='POST'?z.object({requestId:id,sessionId:uuid,claimId:uuid}).strict().parse(await body(request)):null;
 const requestId=input?.requestId||id.parse(url.searchParams.get('requestId')),current=await load(user),item=current.state.applications?.find(a=>a.id===requestId);
 if(!item)throw new DomainError('This application is not in your workspace.',404);
 if(!input)return response({...browserWindowState(user.userId,item,await getBrowserWindow(database(),user.userId,item.id)),applicationStatus:item.status});
 return response(await requestBrowserWindow(database(),user.userId,item,input.sessionId,input.claimId));
}catch(error){return failure(error);}}
export async function workerBrowserWindow(request:Request){try{
 const user=await applicationWorkerIdentity(request),input=z.object({requestId:id,claimId:uuid,sessionId:uuid,event:z.enum(['ready','poll','closed']),openedId:uuid.optional(),error:z.literal('window_unavailable').optional()}).strict().parse(await body(request));
 const current=await load(user),item=activeClaim(current.state,input.requestId,input.claimId);
 return response(await updateBrowserWindow(database(),user.userId,item,input));
}catch(error){return failure(error);}}
