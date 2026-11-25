import {env} from 'cloudflare:workers';
import {load,save,files,type Identity} from './cyber-store';
import {DomainError,record} from './cyber-domain';
import {assertApplicationAuthorizationCurrent} from './application-agent-state';
import type {BrowserWindowRow} from './application-browser-window';
import {canAutomaticallyRecoverBrowser,queueAutomaticBrowserRecovery} from './automatic-browser-recovery';
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
export async function recoverExpiredBrowserSessions(user:Identity,agentHash?:string){
 if(!env.DB)throw new DomainError('Browser recovery is unavailable.',503);
 let restored=0;const checked=new Set<string>();
 // At most two original-file checks per call; the next heartbeat can handle more.
 for(let attempt=0;attempt<2;attempt++){
  const current=await load(user),config=current.state.newApplicationAgent;
  if(!config?.enabled||Date.parse(config.expiresAt)<=Date.now()||agentHash&&config.tokenHash!==agentHash)break;
  const rows=(await env.DB.prepare('SELECT * FROM cyber_application_browser_windows WHERE owner_id=? ORDER BY seen_at DESC LIMIT 1000').bind(user.userId).all<BrowserWindowRow>()).results;
  const item=current.state.applications?.find(item=>!checked.has(item.id)&&canAutomaticallyRecoverBrowser(user.userId,item,rows.find(row=>row.request_id===item.id)||null));
  if(!item)break;checked.add(item.id);
  const file=current.state.attachments.find(file=>file.id===item.cv?.fileId),job=current.state.jobs.find(job=>job.id===item.jobId);
  if(!file||!job||job.source?.availability==='closed')continue;
  try{assertApplicationAuthorizationCurrent(current.state,item);}catch{continue;}
  const object=await files().get(file.key);if(!object||await digest(await object.arrayBuffer())!==item.cvSha256)continue;
  // Re-read after the file operation. A new Open, Submit, reconnection or account
  // change invalidates the old decision instead of being overwritten.
  const latest=await load(user),next=latest.state.applications?.find(next=>next.id===item.id),connection=latest.state.newApplicationAgent;
  if(!connection?.enabled||Date.parse(connection.expiresAt)<=Date.now()||connection.tokenHash!==config.tokenHash||!next||next.cv?.fileId!==file.id||next.cvSha256!==item.cvSha256)continue;
  const row=await env.DB.prepare('SELECT * FROM cyber_application_browser_windows WHERE owner_id=? AND request_id=?').bind(user.userId,next.id).first<BrowserWindowRow>();
  if(!canAutomaticallyRecoverBrowser(user.userId,next,row))continue;
  try{assertApplicationAuthorizationCurrent(latest.state,next);queueAutomaticBrowserRecovery(user.userId,next,row!);record(latest.state,'automatic_browser_recovery','Queued recovery of a verified unsent application browser. Original CV and saved answers retained; final Submit remains manual.','agent');await save(user,latest.revision,latest.state,'automatic_browser_recovery');restored++;}catch(error){if(!(error instanceof DomainError)||error.status!==409)throw error;}
 }
 return {restored};
}
