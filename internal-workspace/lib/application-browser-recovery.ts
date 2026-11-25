import {canAutomaticallyRecoverBrowser} from './automatic-browser-recovery';
import type {ApplicationRequest,Job} from './cyber-domain';
import {browserWindowState,type BrowserWindowRow} from './application-browser-window';
import {manualBrowserHealth} from './manual-browser-health';
import {manualDisplaySession,manualSession} from './manual-submission';

export type RecoveryEntry={requestId:string;title:string;company:string;state:'connected'|'starting'|'lost'|'restoring'|'closed_unsent';manual:boolean;canRecover:boolean;autoRecoverable?:boolean;message:string};
export type RecoverySnapshot={checkedAt:string;entries:RecoveryEntry[];blocked:boolean;needsRecovery:boolean};
/** Only a request that currently expects a browser can lock the page. Ordinary answer pauses and completed records do not. */
export function browserRecoverySnapshot(owner:string,applications:ApplicationRequest[],jobs:Job[],rows:BrowserWindowRow[],now=Date.now()):RecoverySnapshot{
 const entries:RecoveryEntry[]=[];
 const ownRows=new Map(rows.filter(row=>row.owner_id===owner).map(row=>[row.request_id,row]));
 for(const item of applications){
  const manual=manualDisplaySession(item);
  if(item.status!=='processing'&&!manual)continue;
  const job=jobs.find(job=>job.id===item.jobId),base={requestId:item.id,title:job?.title||'Application',company:job?.company||'Employer',manual:!!manual,canRecover:false,autoRecoverable:canAutomaticallyRecoverBrowser(owner,item,ownRows.get(item.id)||null,now)};
  if(manual?.state==='reopening'){entries.push({...base,state:'restoring',message:'Rebuilding this same unsent form. Waiting for its new browser connection.'});continue;}
  if(manual?.state==='closed_before_submit'){entries.push({...base,state:'closed_unsent',canRecover:true,message:base.autoRecoverable?'The browser closed with verified unsent evidence. Automatic recovery is preparing the replacement.':'The browser closed before any recorded submission. Check safe recovery below.'});continue;}
  if(manualSession(item)){
   const health=manualBrowserHealth(owner,item,ownRows.get(item.id)||null,now);
   entries.push({...base,state:health.state==='connected'?'connected':'lost',canRecover:health.canRestore||health.canConfirmUnsent===true,message:health.state==='connected'?'The exact filled browser is connected.':'This exact browser stopped reporting. Review safe recovery below; do not submit again if its outcome is uncertain.'});continue;
  }
  const row=ownRows.get(item.id)||null,available=browserWindowState(owner,item,row,now).available;
  const recentlyClaimed=!row&&Number.isFinite(Date.parse(item.claim?.at||''))&&now-Date.parse(item.claim!.at)>=0&&now-Date.parse(item.claim!.at)<90000;
  entries.push({...base,state:available?'connected':recentlyClaimed?'starting':'lost',message:available?'This application browser is connected.':recentlyClaimed?'The runner is starting this application browser.':'The form browser is unavailable. It cannot be restarted here without evidence that it was unsent. Keep this request paused and check its outcome.'});
 }
 return {checkedAt:new Date(now).toISOString(),entries,blocked:entries.some(entry=>entry.state!=='connected'),needsRecovery:entries.some(entry=>['lost','closed_unsent'].includes(entry.state))};
}

export function recoveryGate(snapshot:RecoverySnapshot|null,expectsBrowser:boolean,failed=false,now=Date.now()){
 const stale=!!snapshot&&(!Number.isFinite(Date.parse(snapshot.checkedAt))||Date.parse(snapshot.checkedAt)<now-20000||Date.parse(snapshot.checkedAt)>now+1000);
 // One missed HTTP check is not proof that a still-fresh exact browser died.
 const unavailable=stale||failed&&!snapshot;
 return {blocked:unavailable?(expectsBrowser||!!snapshot?.entries.length):snapshot?snapshot.blocked:expectsBrowser,highlighted:!!snapshot?.needsRecovery||unavailable&&(expectsBrowser||!!snapshot?.entries.length),checking:!snapshot&&!failed||stale||failed};
}
