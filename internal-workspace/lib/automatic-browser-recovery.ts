import {DomainError,type ApplicationRequest} from './cyber-domain';
import type {BrowserWindowRow} from './application-browser-window';
import {lostManualRecoveryEligible,closedBeforeSubmit} from './manual-submission';
export const AUTO_RECOVERY_STALE_MS=90000,AUTO_RECOVERY_LIMIT=3,AUTO_RECOVERY_STABLE_MS=300000;
function recoveryCount(item:ApplicationRequest,row:BrowserWindowRow){const prior=item.report?.restart_recovery as Record<string,unknown>|undefined;if(prior?.source!=='automatic_expired_session'||row.seen_at-Date.parse(item.manualSubmission!.at)>=AUTO_RECOVERY_STABLE_MS)return 0;const n=prior.count;return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:AUTO_RECOVERY_LIMIT;}
/** Positive unsent evidence, exact browser identity and bounded repairs only. */
export function canAutomaticallyRecoverBrowser(owner:string,item:ApplicationRequest,row:BrowserWindowRow|null,now=Date.now()){
 const h=item.manualSubmission;
 if(!h||item.receiptVerification||!Number.isFinite(Date.parse(h.at))||!Number.isFinite(Date.parse(h.updatedAt))||h.browserHealthVersion!==1||!h.browserSessionId||!item.cvSha256||!row||row.owner_id!==owner||row.request_id!==item.id||row.claim_id!==h.claimId||row.session_id!==h.browserSessionId||!Number.isFinite(row.seen_at)||row.seen_at>now+1000||recoveryCount(item,row)>=AUTO_RECOVERY_LIMIT)return false;
 if(h.state==='closed_before_submit'&&closedBeforeSubmit(item))return row.closed===1&&Date.parse(h.updatedAt)<=now-5000;
 return lostManualRecoveryEligible(item)&&!h.openRequested&&!h.openCommandId&&!h.openRequestedAt&&!h.openedCommandId&&!row.open_id&&!row.opened_id&&(row.closed===1||row.seen_at<now-AUTO_RECOVERY_STALE_MS);
}
export function queueAutomaticBrowserRecovery(owner:string,item:ApplicationRequest,row:BrowserWindowRow,now=Date.now()){
 if(!canAutomaticallyRecoverBrowser(owner,item,row,now))throw new DomainError('This browser cannot be automatically recovered without checking its outcome.',409);
 const h=item.manualSubmission!,at=new Date(now).toISOString(),count=recoveryCount(item,row)+1;
 item.manualSubmission={id:h.id,claimId:h.claimId,state:'reopening',at:h.at,updatedAt:at,challengeHosts:h.challengeHosts,approvedHosts:[],openRequested:false};
 item.status='queued';item.agentAuthorizedAt=at;
 item.report={...item.report,restart_recovery:{source:'automatic_expired_session',at,count,previousClaimId:h.claimId},manual_submission:{...(item.report?.manual_submission as object),state:'reopening',window:'hidden',recovery_source:'automatic_expired_unsent'}};
 item.result={at,message:'Automatically recovering this verified unsent browser with its original CV and saved answers. The replacement stays hidden until you choose Open. Final Submit remains manual.'};
}
