import {env} from 'cloudflare:workers';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {browserRecoverySnapshot} from '@/lib/application-browser-recovery';
import type {BrowserWindowRow} from '@/lib/application-browser-window';
export const dynamic='force-dynamic';
/** Read-only connection check. Recovery continues through the existing per-request owner controls. */
export async function GET(request:Request){try{
 const user=await identity(request),current=await load(user);
 if(!env.DB)throw new DomainError('Browser connection checks are unavailable.',503);
 const rows=await env.DB.prepare('SELECT * FROM cyber_application_browser_windows WHERE owner_id=? ORDER BY seen_at DESC LIMIT 1000').bind(user.userId).all<BrowserWindowRow>();
 return response(browserRecoverySnapshot(user.userId,current.state.applications||[],current.state.jobs,rows.results));
}catch(error){return failure(error);}}
