import {DomainError,type ApplicationRequest} from './cyber-domain';
export type ManualSubmission={id:string;claimId:string;state:'ready'|'needs_submit'|'closed_before_submit'|'closed_after_error'|'reopening'|'cancel_requested'|'cancelled'|'confirmed';at:string;updatedAt:string;challengeHosts:string[];approvedHosts:string[];openRequested?:boolean;reopenConfirmedAt?:string;receipt?:{url:string;text:string};browserSessionId?:string;browserHealthVersion?:1;openCommandId?:string;openRequestedAt?:string;openedCommandId?:string;openError?:'window_unavailable';browserExposedAt?:string;retryAfterErrorAt?:string;verificationStage?:'email_code';processingError?:{at:string;source:'browser'|'owner';httpStatus?:number}};
export type ManualBrowserHealth={state:'checking'|'connected'|'not_reporting';open:'idle'|'pending'|'opened'|'failed'|'timed_out';canRestore:boolean;canConfirmUnsent?:boolean;lastSeenAt?:string;legacy?:boolean;recoveryPhase?:'queued'|'working'};
export function lostManualRecoveryEligible(item:ApplicationRequest){
 const h=manualSession(item),j=item.report?.journey as Record<string,unknown>|undefined,m=item.report?.manual_submission as Record<string,unknown>|undefined;
 return !!h&&h.state==='ready'&&h.browserHealthVersion===1&&!h.browserExposedAt&&!item.result?.receipt&&!item.result?.evidence&&!h.receipt&&j?.version===1&&j.continue_click_attempts===0&&j.submit_click_attempts===0&&j.possible_delivery===false&&j.manual_submit_observed===false&&j.human_submit_observed===0&&m?.policy==='user_final_submit'&&m.human_submit_observed===0&&m.recovery_cancelled!==true;
}
/** A legacy lost session needs a fresh owner declaration, never fabricated worker evidence. */
export function ownerConfirmedUnsentEligible(item:ApplicationRequest){
 const h=manualSession(item),j=item.report?.journey as Record<string,unknown>|undefined,m=item.report?.manual_submission as Record<string,unknown>|undefined;
 return !!h&&h.state==='ready'&&!h.browserHealthVersion&&!item.result?.receipt&&!item.result?.evidence&&!h.receipt&&j?.version===1&&j.continue_click_attempts===0&&j.submit_click_attempts===0&&j.possible_delivery===false&&j.manual_submit_observed===false&&j.human_submit_observed===0&&m?.policy==='user_final_submit'&&m.window==='hidden'&&m.human_submit_observed===0&&m.recovery_cancelled!==true;
}
/** An exposed form needs a new owner declaration; absence of delivery alone is not permission. */
export function ownerConfirmedOpenedUnsentEligible(item:ApplicationRequest){
 const h=manualSession(item),j=item.report?.journey as Record<string,unknown>|undefined,m=item.report?.manual_submission as Record<string,unknown>|undefined;
 return !!h&&h.state==='ready'&&h.browserHealthVersion===1&&!!h.browserSessionId&&!!h.browserExposedAt&&Number.isFinite(Date.parse(h.browserExposedAt))
  &&!item.result?.receipt&&!item.result?.evidence&&!h.receipt&&j?.version===1&&j.continue_click_attempts===0&&j.submit_click_attempts===0
  &&j.possible_delivery===false&&j.manual_submit_observed===false&&j.human_submit_observed===0&&m?.policy==='user_final_submit'&&m.human_submit_observed===0&&m.recovery_cancelled!==true;
}
export function restoreOwnerConfirmedUnsent(item:ApplicationRequest,id:string,hosts:string[],confirmed:boolean){
 const h=manualSession(item),opened=ownerConfirmedOpenedUnsentEligible(item);if(!h||h.id!==id||!ownerConfirmedUnsentEligible(item)&&!opened)throw new DomainError('This form has missing or conflicting submission evidence. No application was restarted.',409);
 if(!confirmed)throw new DomainError('Confirm that you never pressed final Submit and the old window is no longer available.',409);
 if(hosts.some(host=>!h.challengeHosts.includes(host))||h.challengeHosts.some(host=>!hosts.includes(host)))throw new DomainError('Approve exactly the listed reCAPTCHA destinations.',409);
 const at=new Date().toISOString();item.manualSubmission={id:h.id,claimId:h.claimId,state:'reopening',at:h.at,updatedAt:at,challengeHosts:h.challengeHosts,approvedHosts:hosts,openRequested:false};
 item.status='queued';item.agentAuthorizedAt=at;item.report={...item.report,manual_submission:{...mFrom(item),recovery_source:opened?'owner_declared_opened_unsent':'owner_declared_legacy_unsent',owner_unsent_declaration:{at,never_pressed_final_submit:true,old_window_unavailable:true}}};item.result={at,message:'Rebuilding the same request after your explicit declaration that you never pressed final Submit and the old window is unavailable. Original CV and saved answers retained. The replacement stays hidden until you choose Open; final Submit remains manual.'};return item.manualSubmission;
}
export function restoreLostManualSubmission(item:ApplicationRequest,id:string,hosts:string[],confirmed:boolean){
 const h=manualSession(item);if(!h||h.id!==id||!lostManualRecoveryEligible(item))throw new DomainError('The saved evidence cannot establish that this lost form is unsent. Check the employer outcome before retrying.',409);
 if(!confirmed)throw new DomainError('Confirm the old browser is closed and you never pressed Continue or Submit before rebuilding.',409);
 if(hosts.some(host=>!h.challengeHosts.includes(host))||h.challengeHosts.some(host=>!hosts.includes(host)))throw new DomainError('Approve exactly the listed reCAPTCHA destinations.',409);
 const now=new Date().toISOString();item.manualSubmission={id:h.id,claimId:h.claimId,state:'reopening',at:h.at,updatedAt:now,challengeHosts:h.challengeHosts,approvedHosts:hosts,openRequested:false,reopenConfirmedAt:now};
 item.status='queued';item.agentAuthorizedAt=now;item.report={...item.report,manual_submission:{...mFrom(item),recovery_source:'user_confirmed_lost_hidden_session'}};item.result={at:now,message:'Rebuilding the unsent form after you confirmed the old session ended without Continue or Submit. The original CV and saved answers are retained. Submit remains manual.'};return item.manualSubmission;
}
function mFrom(item:ApplicationRequest){return item.report?.manual_submission&&typeof item.report.manual_submission==='object'?item.report.manual_submission as Record<string,unknown>:{};}
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
 if(closedAfterSubmissionError(item))return {...item.manualSubmission!,state:'closed_after_error' as const,openRequested:false};
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
 else {if(!openConfirmed)throw new DomainError('Tick the checkbox before opening the CyberApply browser window.',409);if(h.state==='cancel_requested')throw new DomainError('Cancellation is already requested.',409);if(hosts.some(host=>!h.challengeHosts.includes(host)))throw new DomainError('Approve only the displayed reCAPTCHA hosts.',409);if(h.challengeHosts.some(host=>!h.approvedHosts.includes(host)&&!hosts.includes(host)))throw new DomainError('Approve the displayed reCAPTCHA hosts before opening this window.',409);h.approvedHosts=[...new Set([...h.approvedHosts,...hosts])];h.openRequested=true;h.openCommandId=crypto.randomUUID();h.openRequestedAt=new Date().toISOString();delete h.openError;}
 h.updatedAt=new Date().toISOString();return h;
}

/** A reported employer error changes metadata only; the exact browser and delivery evidence remain. */
export function recordManualProcessingError(item:ApplicationRequest,id:string,source:'browser'|'owner',httpStatus?:number){
 const h=manualSession(item);if(!h||h.id!==id||h.state==='cancel_requested')throw new DomainError('This exact manual browser is unavailable. No application was restarted.',409);
 if(source==='owner'&&!h.browserExposedAt)throw new DomainError('Open the exact employer browser before reporting its error.',409);
 const now=new Date().toISOString();item.report={...item.report,journey:{...(item.report?.journey as Record<string,unknown>|undefined),possible_delivery:true}};h.state='needs_submit';h.processingError={at:h.processingError?.at||now,source:h.processingError?.source||source,...(httpStatus?{httpStatus}:h.processingError?.httpStatus?{httpStatus:h.processingError.httpStatus}:{})};h.updatedAt=now;
 item.result={at:now,message:'The employer displayed an application-processing error. The outcome is unverified. Keep this exact browser open and check for employer confirmation before trying again. CyberApply will not retry Submit.'};return h;
}

/** A closed error is eligible for an informed owner choice, never an automatic retry. */
export function closedAfterSubmissionError(item:ApplicationRequest){
 const h=item.manualSubmission,j=item.report?.journey as Record<string,unknown>|undefined,m=mFrom(item);
 return !!h&&h.claimId===item.claim?.id&&h.state==='cancelled'&&item.status==='uncertain'
  &&!item.result?.receipt&&!item.result?.evidence&&!h.receipt&&!item.receiptVerification
  &&m.policy==='user_final_submit'&&j?.version===1&&Number(j.human_submit_observed)>0
  &&!!(h.processingError||m.processing_error||m.state==='needs_submit');
}
export type ManualRetryAttempt={authorizedAt:string;claimId:string;sessionId:string;closedAt:string;journey:Record<string,unknown>;errorKind:'employer_processing_error'|'recaptcha_error';error?:ManualSubmission['processingError'];message?:string};
export function retryClosedSubmissionError(item:ApplicationRequest,id:string,confirmed:boolean){
 const h=item.manualSubmission;if(!h||h.id!==id||!closedAfterSubmissionError(item))throw new DomainError('No closed employer-error attempt is available to retry. No application was restarted.',409);
 if(!confirmed)throw new DomainError('Confirm the error, the closed browser, no confirmation received, and the risk of a duplicate before preparing another attempt.',409);
 if((item.manualRetryHistory?.length||0)>=10)throw new DomainError('The saved retry history is full. Check the employer outcome before further attempts.',409);
 const at=new Date().toISOString();
 item.manualRetryHistory=[...(item.manualRetryHistory||[]),{authorizedAt:at,claimId:h.claimId,sessionId:h.id,closedAt:h.updatedAt,errorKind:h.processingError||mFrom(item).processing_error?'employer_processing_error':'recaptcha_error',journey:structuredClone(item.report!.journey as Record<string,unknown>),...(h.processingError?{error:structuredClone(h.processingError)}:{}),...(item.result?.message?{message:item.result.message}:{})}];
 item.manualSubmission={id:h.id,claimId:h.claimId,state:'reopening',at:h.at,updatedAt:at,challengeHosts:[],approvedHosts:[],openRequested:false,retryAfterErrorAt:at};
 // Start a distinct attempt. Prior delivery evidence stays in the immutable attempt snapshot.
 item.report={manual_submission:{policy:'user_final_submit',state:'reopening',window:'hidden',recovery_source:'owner_authorized_retry_after_error'}};
 delete item.verificationHandoff;delete item.profileSync;
 item.status='queued';item.agentAuthorizedAt=at;item.result={at,message:'You authorized another attempt after an employer error and accepted the duplicate risk. Preparing the same vacancy with your original CV and saved answers. The replacement stays hidden until Open; final Submit remains manual.'};
 return item.manualSubmission;
}
