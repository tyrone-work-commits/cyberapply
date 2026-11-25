import {DomainError,type State,type ApplicationRequest} from './cyber-domain';
import type {BrowserWindowRow} from './application-browser-window';
import {lostManualRecoveryEligible} from './manual-submission';
import {MANUAL_BROWSER_FRESH_MS} from './manual-browser-health';

/** A stale heartbeat alone never authorizes replay. Require a newer singleton runner,
 * exact old browser evidence, and a protected form that was never exposed. */
export function restartRecoveryCandidates(state:State,owner:string,rows:BrowserWindowRow[],runnerStartedAt:string,now=Date.now()){
 const boot=Date.parse(runnerStartedAt);
 if(!Number.isFinite(boot)||boot>now+1000||boot<946684800000)return [];
 const own=new Map(rows.filter(row=>row.owner_id===owner).map(row=>[row.request_id,row]));
 return (state.applications||[]).filter(item=>{
  if(!lostManualRecoveryEligible(item)||!item.cvSha256)return false;
  const h=item.manualSubmission!,row=own.get(item.id),updated=Date.parse(h.updatedAt);
  return !!row&&row.claim_id===h.claimId&&row.session_id===h.browserSessionId&&Number.isFinite(updated)
   &&updated<boot-5000&&row.seen_at<boot-5000&&row.seen_at<now-MANUAL_BROWSER_FRESH_MS;
 }).slice(0,10);
}

export function restoreAfterComputerRestart(item:ApplicationRequest,runnerStartedAt:string,at=new Date().toISOString()){
 if(!lostManualRecoveryEligible(item))throw new DomainError('This form cannot be automatically restored. Check its employer outcome.',409);
 const h=item.manualSubmission!;
 const prior=item.report?.restart_recovery as Record<string,unknown>|undefined;
 item.manualSubmission={id:h.id,claimId:h.claimId,state:'reopening',at:h.at,updatedAt:at,
  challengeHosts:h.challengeHosts,approvedHosts:h.approvedHosts.filter(host=>h.challengeHosts.includes(host)),openRequested:false};
 item.status='queued';item.agentAuthorizedAt=at;
 item.report={...item.report,restart_recovery:{runnerStartedAt,at,previousClaimId:h.claimId,count:Math.min(1000,Number(prior?.count||0)+1)},
  manual_submission:{...(item.report?.manual_submission as object),state:'reopening',window:'hidden',recovery_source:'computer_restart_unsent'}};
 item.result={at,message:'The background agent restarted. Restoring this same unsent application with its original CV and saved answers. The replacement stays hidden until you choose Open. Final Submit remains manual.'};
}
