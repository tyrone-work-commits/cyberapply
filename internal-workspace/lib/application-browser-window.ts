import {DomainError,type ApplicationRequest} from './cyber-domain';
export const BROWSER_WINDOW_FRESH_MS=20000;
export type BrowserWindowRow={owner_id:string;request_id:string;claim_id:string;session_id:string;seen_at:number;closed:number;open_id:string|null;opened_id:string|null;error:string};
export type BrowserWindowState={available:boolean;sessionId?:string;claimId?:string;opening?:boolean;opened?:boolean;error?:string};
const manualOpenOnly=(item:ApplicationRequest)=>item.status==='processing'&&item.manualSubmission?.claimId===item.claim?.id&&['ready','needs_submit','reopening','cancel_requested'].includes(item.manualSubmission?.state||'');
export function browserWindowState(owner:string,item:ApplicationRequest,row:BrowserWindowRow|null,now=Date.now()):BrowserWindowState{
 if(manualOpenOnly(item)||!row||row.owner_id!==owner||row.request_id!==item.id||item.status!=='processing'||row.claim_id!==item.claim?.id||row.closed||row.seen_at<now-BROWSER_WINDOW_FRESH_MS||row.seen_at>now+1000)return {available:false};
 return {available:true,sessionId:row.session_id,claimId:row.claim_id,opening:!!row.open_id&&row.open_id!==row.opened_id,opened:!!row.open_id&&row.open_id===row.opened_id&&!row.error,...(row.error?{error:row.error}:{})};
}
export const getBrowserWindow=(db:D1Database,owner:string,id:string)=>db.prepare('SELECT * FROM cyber_application_browser_windows WHERE owner_id=? AND request_id=?').bind(owner,id).first<BrowserWindowRow>();
export async function requestBrowserWindow(db:D1Database,owner:string,item:ApplicationRequest,sessionId:string,claimId:string,now=Date.now()){
 const row=await getBrowserWindow(db,owner,item.id);
 if(!browserWindowState(owner,item,row,now).available||row!.session_id!==sessionId||row!.claim_id!==claimId)throw new DomainError('The agent’s exact browser is not available. No new tab or application was opened.',409);
 const openId=crypto.randomUUID();
 const result=await db.prepare(`UPDATE cyber_application_browser_windows SET open_id=?,error='' WHERE owner_id=? AND request_id=? AND claim_id=? AND session_id=? AND closed=0 AND seen_at>=?`).bind(openId,owner,item.id,claimId,sessionId,now-BROWSER_WINDOW_FRESH_MS).run();
 if(result.meta.changes!==1)throw new DomainError('The agent browser changed. Refresh its status before opening it.',409);
 return {available:true,sessionId,claimId,opening:true,opened:false} satisfies BrowserWindowState;
}
export async function updateBrowserWindow(db:D1Database,owner:string,item:ApplicationRequest,input:{sessionId:string;event:'ready'|'poll'|'closed';openedId?:string;error?:'window_unavailable'},now=Date.now()){
 const claim=item.claim!.id;
 if(input.event==='ready'){
  await db.prepare('DELETE FROM cyber_application_browser_windows WHERE owner_id=? AND seen_at<?').bind(owner,now-86400000).run();
  await db.prepare(`INSERT INTO cyber_application_browser_windows(owner_id,request_id,claim_id,session_id,seen_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,request_id) DO UPDATE SET claim_id=excluded.claim_id,session_id=excluded.session_id,seen_at=excluded.seen_at,closed=0,open_id=NULL,opened_id=NULL,error='' WHERE cyber_application_browser_windows.claim_id<>excluded.claim_id OR (cyber_application_browser_windows.session_id<>excluded.session_id AND cyber_application_browser_windows.seen_at<?)`).bind(owner,item.id,claim,input.sessionId,now,now-BROWSER_WINDOW_FRESH_MS).run();
 }
 const result=await db.prepare(`UPDATE cyber_application_browser_windows SET seen_at=?,closed=?,opened_id=CASE WHEN open_id=? THEN ? ELSE opened_id END,error=CASE WHEN open_id=? THEN ? ELSE error END WHERE owner_id=? AND request_id=? AND claim_id=? AND session_id=? AND closed=0`).bind(now,input.event==='closed'?1:0,input.openedId||'',input.openedId||null,input.openedId||'',input.error||'',owner,item.id,claim,input.sessionId).run();
 if(result.meta.changes!==1)throw new DomainError('This exact browser session is no longer active.',409);
 const row=await getBrowserWindow(db,owner,item.id);
 return {openId:input.event==='closed'||manualOpenOnly(item)?null:row?.open_id!==row?.opened_id?row?.open_id:null};
}
