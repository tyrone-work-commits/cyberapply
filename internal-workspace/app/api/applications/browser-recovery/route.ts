import {z} from 'zod';
import {recoverExpiredBrowserSessions} from '@/lib/application-browser-recovery-server';
import {env} from 'cloudflare:workers';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {browserRecoverySnapshot} from '@/lib/application-browser-recovery';
import type {BrowserWindowRow} from '@/lib/application-browser-window';
export const dynamic='force-dynamic';
/** GET reports connection status; POST performs only guarded unsent recovery. */
export async function GET(request:Request){try{
 const user=await identity(request),current=await load(user);
 if(!env.DB)throw new DomainError('Browser connection checks are unavailable.',503);
 const rows=await env.DB.prepare('SELECT * FROM cyber_application_browser_windows WHERE owner_id=? ORDER BY seen_at DESC LIMIT 1000').bind(user.userId).all<BrowserWindowRow>();
 return response(browserRecoverySnapshot(user.userId,current.state.applications||[],current.state.jobs,rows.results));
}catch(error){return failure(error);}}

export async function POST(request:Request){try{
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin){const length=request.headers.get('content-length');if(length!==null&&Number.isSafeInteger(Number(length))&&Number(length)>=0&&Number(length)<=2000)await request.arrayBuffer();else await request.body?.cancel();throw new DomainError('Cross-origin browser recovery is not allowed.',403);}
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 const raw=await request.text();if(raw.length>2000)throw new DomainError('Recovery request is too large.',413);
 let body:unknown;try{body=JSON.parse(raw);}catch{throw new DomainError('Send valid JSON.');}
 if(!z.object({action:z.literal('recover_expired_sessions')}).strict().safeParse(body).success)throw new DomainError('Choose automatic expired-session recovery.');
 const user=await identity(request),recovery=await recoverExpiredBrowserSessions(user),current=await load(user);
 const rows=await env.DB!.prepare('SELECT * FROM cyber_application_browser_windows WHERE owner_id=? ORDER BY seen_at DESC LIMIT 1000').bind(user.userId).all<BrowserWindowRow>();
 return response({...browserRecoverySnapshot(user.userId,current.state.applications||[],current.state.jobs,rows.results),...recovery});
}catch(error){return failure(error);}}
