import {DomainError,type ApplicationRequest} from './cyber-domain';
export type ManualSubmission={id:string;claimId:string;state:'ready'|'needs_submit'|'closed_before_submit'|'reopening'|'cancel_requested'|'cancelled'|'confirmed';at:string;updatedAt:string;challengeHosts:string[];approvedHosts:string[];openRequested?:boolean;reopenConfirmedAt?:string;receipt?:{url:string;text:string}};
/** A waiting browser is never reclaimed or automatically replayed, even offline. */
export function manualSession(item:ApplicationRequest){const h=item.manualSubmission;return item.status==='processing'&&h&&h.claimId===item.claim?.id&&['ready','needs_submit','cancel_requested'].includes(h.state)?h:null;}
/** Positive evidence only. Missing counters, prior Continue, or possible delivery forbid recovery. */
export function closedBeforeSubmit(item:ApplicationRequest){
 const j=item.report?.journey as Record<string,unknown>|undefined,m=item.report?.manual_submission as Record<string,unknown>|undefined;
 return !!item.manualSubmission&&item.manualSubmission.claimId===item.claim?.id&&['closed_before_submit','cancelled'].includes(item.manualSubmission.state)&&['uncertain','needs_attention'].includes(item.status)&&!item.result?.receipt&&!item.result?.evidence&&!item.manualSubmission.receipt&&j?.version===1&&j.continue_click_attempts===0&&j.submit_click_attempts===0&&j.possible_delivery===false&&j.manual_submit_observed===false&&j.human_submit_observed===0&&m?.policy==='user_final_submit'&&m.human_submit_observed===0&&m.recovery_cancelled!==true;
}
/** Display recovery without silently restarting an old or possibly delivered application. */
export function manualDisplaySession(item:ApplicationRequest){
 const active=manualSession(item);if(active)return active;
 if(closedBeforeSubmit(item))return {...item.manualSubmission!,state:'closed_before_submit' as const,approvedHosts:[],openRequested:false};
 if(item.manualSubmission?.state==='reopening'&&['queued','processing'].includes(item.status))return item.manualSubmission;
 return null;
}
export function recoverManualSubmission(item:ApplicationRequest,id:string,hosts:string[],openConfirmed:boolean,closedConfirmed:boolean){
 const h=manualDisplaySession(item);if(!h||h.id!==id||h.state!=='closed_before_submit'||!closedBeforeSubmit(item))throw new DomainError('No verified unsent browser is available to reopen. Check the employer outcome before retrying.',409);
 if(!openConfirmed||!closedConfirmed)throw new DomainError('Confirm that you closed the window before pressing Submit before refilling this application.',409);
 if(hosts.some(host=>!h.challengeHosts.includes(host))||h.challengeHosts.some(host=>!hosts.includes(host)))throw new DomainError('Approve only all displayed reCAPTCHA hosts for the replacement browser.',409);
 const now=new Date().toISOString();item.manualSubmission={...h,state:'reopening',approvedHosts:hosts,openRequested:false,reopenConfirmedAt:now,updatedAt:now};
 item.status='queued';item.agentAuthorizedAt=now;item.result={at:now,message:'Reopening this unsent application with the original CV and saved answers. Submit remains manual.'};
 return item.manualSubmission;
}
export function manualCommand(item:ApplicationRequest,id:string,command:'open'|'cancel',hosts:string[]=[],openConfirmed=false){
 const h=manualSession(item);if(!h||h.id!==id||!['ready','needs_submit','cancel_requested'].includes(h.state))throw new DomainError('This exact browser session is unavailable. No new application was started.',409);
 if(command==='cancel'){h.state='cancel_requested';h.openRequested=false;}
 else {if(!openConfirmed)throw new DomainError('Tick the checkbox before opening the CyberApply browser window.',409);if(h.state==='cancel_requested')throw new DomainError('Cancellation is already requested.',409);if(hosts.some(host=>!h.challengeHosts.includes(host)))throw new DomainError('Approve only the displayed reCAPTCHA hosts.',409);if(h.challengeHosts.some(host=>!h.approvedHosts.includes(host)&&!hosts.includes(host)))throw new DomainError('Approve the displayed reCAPTCHA hosts before opening this window.',409);h.approvedHosts=[...new Set([...h.approvedHosts,...hosts])];h.openRequested=true;}
 h.updatedAt=new Date().toISOString();return h;
}
