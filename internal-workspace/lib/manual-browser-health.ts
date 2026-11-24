import type {ApplicationRequest} from './cyber-domain';
import type {BrowserWindowRow} from './application-browser-window';
import {manualSession,lostManualRecoveryEligible,ownerConfirmedUnsentEligible,type ManualBrowserHealth} from './manual-submission';
export const MANUAL_BROWSER_FRESH_MS=20000,MANUAL_OPEN_ACK_MS=15000;
/** A process-wide heartbeat cannot establish that this exact form is alive. */
export function manualBrowserHealth(owner:string,item:ApplicationRequest,row:BrowserWindowRow|null,now=Date.now()):ManualBrowserHealth{
 const h=manualSession(item),scoped=!!h&&!!row&&row.owner_id===owner&&row.request_id===item.id&&row.claim_id===item.claim?.id&&(!h.browserSessionId||row.session_id===h.browserSessionId);
 const fresh=scoped&&!row!.closed&&row!.seen_at>=now-MANUAL_BROWSER_FRESH_MS&&row!.seen_at<=now+1000;
 let open:ManualBrowserHealth['open']='idle';
 if(h?.openCommandId)open=h.openedCommandId===h.openCommandId?(h.openError?'failed':'opened'):Number.isFinite(Date.parse(h.openRequestedAt||''))&&now-Date.parse(h.openRequestedAt!)>MANUAL_OPEN_ACK_MS?'timed_out':'pending';
 return {state:fresh?'connected':'not_reporting',open,canRestore:!fresh&&lostManualRecoveryEligible(item),canConfirmUnsent:!fresh&&ownerConfirmedUnsentEligible(item),...(scoped?{lastSeenAt:new Date(row!.seen_at).toISOString()}:{}),...(!h?.browserHealthVersion?{legacy:true}:{})};
}
/** Never overwrite durable evidence of possible delivery with an older snapshot. */
export function mergeManualReport(prior:Record<string,unknown>|undefined,next:Record<string,unknown>){
 const a=prior?.journey as Record<string,unknown>|undefined,b=next.journey as Record<string,unknown>|undefined;
 const journey={...a,...b};
 for(const key of ['continue_click_attempts','submit_click_attempts','human_submit_observed'])if(typeof a?.[key]==='number'&&typeof b?.[key]==='number')journey[key]=Math.max(a[key] as number,b[key] as number);
 for(const key of ['possible_delivery','manual_submit_observed'])if(a?.[key]===true)journey[key]=true;
 const oldManual=prior?.manual_submission as Record<string,unknown>|undefined,newManual=next.manual_submission as Record<string,unknown>|undefined;
 const manual={...oldManual,...newManual};if(typeof oldManual?.human_submit_observed==='number')manual.human_submit_observed=Math.max(oldManual.human_submit_observed,typeof newManual?.human_submit_observed==='number'?newManual.human_submit_observed:0);
 return {...prior,...next,...(a||b?{journey}:{}),...(oldManual||newManual?{manual_submission:manual}:{})};
}
