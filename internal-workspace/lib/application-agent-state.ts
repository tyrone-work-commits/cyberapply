import {persistentQuestionHandoff} from './verification-handoff';
import {manualSession} from './manual-submission';
import {rememberEmployerQuestions} from './employer-questions';
import { DomainError, record, safeJobUrl, applicationProfile, getApplySettings, applicationPolicyIssue, applicationRunsToday, type State } from './cyber-domain';

export const MAX_PARALLEL_APPLICATIONS=10;
export function claimApplication(state:State,at=new Date().toISOString(),parallel=false){
  if(!parallel&&state.applications?.some(item=>manualSession(item)||persistentQuestionHandoff(item)))return null;
  for(const item of state.applications||[])if(item.agentVersion===2&&item.status==='processing'&&item.claim&&!manualSession(item)&&!persistentQuestionHandoff(item)&&Date.parse(item.claim.expiresAt)<=Date.parse(at)){
    item.status='uncertain';item.result={at,message:'The browser runner stopped reporting. Check the employer outcome before any retry.'};
  }
  if((state.applications||[]).filter(item=>item.agentVersion===2&&item.status==='processing').length>=(parallel?MAX_PARALLEL_APPLICATIONS:1))return null;
  const request=state.applications?.find(item=>item.agentVersion===2&&item.status==='queued'&&item.agentAuthorizedAt);
  if(!request)return null;
  if(request.report?.journey&&typeof request.report.journey==='object'&&(request.report.journey as Record<string,unknown>).possible_delivery===true){request.status='uncertain';delete request.agentAuthorizedAt;request.result={at,message:'A prior run may have delivered this application. Check the employer outcome before any retry.'};return null;}
  if(!request.cv||!state.attachments.some(item=>item.id===request.cv!.fileId)){
    request.status='needs_attention';request.result={at,message:'The chosen CV is unavailable. Attach a CV before trying again.'};return null;
  }
  const job=state.jobs.find(j=>j.id===request.jobId);if(!job||job.source?.availability==='closed'){request.status='needs_attention';request.result={at,message:'This vacancy is no longer available. No employer form was opened.'};return null;}
  const policy=applicationPolicyIssue(state,job,request.candidate.resumeText,at,!request.reviewedForSubmissionAt);if(policy){request.reason=policy;request.status='needs_action';delete request.agentAuthorizedAt;return null;}
  if(request.reason==='daily_limit')request.reason='connection_required';
  state.applicationUsage={day:at.slice(0,10),started:applicationRunsToday(state,at)+1};
  request.applicantProfile=applicationProfile(state);
  request.status='processing';request.claim={id:crypto.randomUUID(),at,expiresAt:new Date(Date.parse(at)+15*60_000).toISOString()};
  if(request.manualSubmission?.state==='reopening')request.manualSubmission.claimId=request.claim.id;
  record(state,'application_agent_claim','The CV application agent started an authorized request.','agent',at);
  return request;
}
export function activeClaim(state:State,requestId:string,claimId:string,at=new Date().toISOString()){
  const request=state.applications?.find(item=>item.id===requestId&&item.agentVersion===2);
  if(!request||request.status!=='processing'||request.claim?.id!==claimId||(!manualSession(request)&&!persistentQuestionHandoff(request)&&Date.parse(request.claim.expiresAt)<=Date.parse(at)))throw new DomainError('This claim is unavailable or expired. Check the employer outcome before retrying.',409);
  if(!request.cv||!state.attachments.some(file=>file.id===request.cv!.fileId))throw new DomainError('The CV for this claim is unavailable.',409);
  return request;
}
export function completeApplication(state:State,input:{requestId:string;claimId:string;status:'applied'|'needs_attention'|'uncertain'|'failed';message:string;receipt?:string;evidence?:{url:string;text:string};report?:Record<string,unknown>},at=new Date().toISOString()){
  const request=activeClaim(state,input.requestId,input.claimId,at);
  if(input.status==='applied'&&(!input.receipt||!input.evidence?.text.trim()||!safeJobUrl(input.evidence.url)))throw new DomainError('Applied requires an explicit employer confirmation and its URL.',409);
  request.status=input.status;request.result={at,message:input.message,...(input.receipt?{receipt:input.receipt}:{}),...(input.evidence?{evidence:input.evidence}:{})};
  if(input.report){request.report=input.report;rememberEmployerQuestions(state,request,input.report,at);}
  record(state,'application_agent_result',`Application agent: ${input.status.replaceAll('_',' ')}. ${input.message}`,'agent',at);
  return request;
}

export function assertApplicationProfileCurrent(state:State,request:NonNullable<State['applications']>[number]){if(!request.applicantProfile||JSON.stringify(request.applicantProfile)!==JSON.stringify(applicationProfile(state)))throw new DomainError('Edit Profile changed or an Answers library response was updated during this application. Stop and update the application before submitting.',409);}

export function assertApplicationAuthorizationCurrent(state:State,request:NonNullable<State['applications']>[number]){if(!getApplySettings(state).autoConsentAt&&!request.reviewedForSubmissionAt)throw new DomainError('Authorize Automatic Apply in application settings before submitting this request.',409);}
