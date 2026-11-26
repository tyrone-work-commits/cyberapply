import {applicationProfile,DomainError,type State,type ApplicationRequest} from './cyber-domain';
import {preparedProfileKey} from './prepared-profile';
import {currentHandoff} from './verification-handoff';
import {employerQuestionKey,manualAnswerOnly} from './employer-questions';

export type ApplicationProfileSync={id:string;claimId?:string;state:'pending'|'applied'|'failed';at:string;appliedAt?:string;code?:'form_needs_answers'|'form_changed'};
export function applicationProfileChanged(state:State,item:ApplicationRequest){return preparedProfileKey(item.applicantProfile)!==preparedProfileKey(applicationProfile(state));}
export function applicationSyncAllowed(item:ApplicationRequest){
 const journey=item.report?.journey as Record<string,unknown>|undefined;
 return item.agentVersion===2&&!!item.applicantProfile&&!['applied','uncertain','failed'].includes(item.status)&&!item.result?.receipt&&!item.result?.evidence&&!item.receiptVerification&&journey?.possible_delivery!==true&&journey?.manual_submit_observed!==true&&!Number(journey?.human_submit_observed)&&!Number(journey?.submit_click_attempts)&&!Number(journey?.continue_click_attempts)&&!item.manualSubmission;
}
export function applicationSyncInfo(state:State,item:ApplicationRequest){
 const changed=applicationProfileChanged(state,item),pending=item.profileSync?.state==='pending',failed=item.profileSync?.state==='failed',handoff=currentHandoff(item);
 return {outOfSync:changed||pending||failed,changed,state:pending?'pending':failed?'failed':changed?'out_of_sync':'current',canSync:applicationSyncAllowed(item)&&(item.status!=='processing'||!!handoff&&['waiting','opened'].includes(handoff.state)&&(handoff.profileSyncVersion===1||!changed)),sameBrowser:!!handoff};
}
export function synchronizeApplicationProfile(state:State,item:ApplicationRequest,at=new Date().toISOString()){
 if(!applicationSyncAllowed(item))throw new DomainError('This application cannot be synchronized in place after a possible submission or final-submit handoff. No application was restarted.',409);
 const changed=applicationProfileChanged(state,item)||item.profileSync?.state==='pending'||item.profileSync?.state==='failed',h=currentHandoff(item);
 if(item.status==='processing'&&(!h||!['waiting','opened'].includes(h.state)))throw new DomainError('Wait until this exact browser pauses for your input before synchronizing its prepared answers.',409);
 if(changed&&item.status==='processing'&&h?.profileSyncVersion!==1)throw new DomainError('This older browser runner cannot refill changed answers in memory. Its exact browser can still be opened; no application was restarted. Update the runner for future in-place answer changes.',409);
 if(item.profileSync?.state==='pending'&&!applicationProfileChanged(state,item))return item.profileSync;
 const next=applicationProfile(state);
 if(changed)item.confirmedAnswers=(item.confirmedAnswers||[]).filter(answer=>!next.employerQuestions?.some(row=>row.source==='user'&&row.answer.trim()&&employerQuestionKey(row.question)===employerQuestionKey(answer.question)&&row.reusePolicy!=='manual_only'&&!manualAnswerOnly(row.question,[...row.options,row.answer])));
 item.applicantProfile=next;
 item.profileSync={id:crypto.randomUUID(),claimId:item.claim?.id,state:changed&&item.status==='processing'?'pending':'applied',at,...(!changed||item.status!=='processing'?{appliedAt:at}:{})};
 if(h&&item.profileSync.state==='pending'){h.state='waiting';delete h.code;}
 return item.profileSync;
}
export function acknowledgeApplicationSync(item:ApplicationRequest,id:string,claimId:string,code?:'form_needs_answers'|'form_changed',at=new Date().toISOString()){
 const sync=item.profileSync;if(!sync||sync.id!==id||sync.claimId!==claimId||item.claim?.id!==claimId)throw new DomainError('The synchronization belongs to another browser or revision.',409);
 if(sync.state!=='pending')return sync;
 sync.state=code?'failed':'applied';sync.code=code;if(!code)sync.appliedAt=at;return sync;
}
