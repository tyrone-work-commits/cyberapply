import { DomainError, record, safeJobUrl, applicationProfile, type State } from './cyber-domain';

export function claimApplication(state:State,at=new Date().toISOString()){
  for(const item of state.applications||[])if(item.agentVersion===2&&item.status==='processing'&&item.claim&&Date.parse(item.claim.expiresAt)<=Date.parse(at)){
    item.status='uncertain';item.result={at,message:'The browser runner stopped reporting. Check the employer outcome before any retry.'};
  }
  const request=state.applications?.find(item=>item.agentVersion===2&&item.status==='queued'&&item.agentAuthorizedAt);
  if(!request)return null;
  if(!request.cv||!state.attachments.some(item=>item.id===request.cv!.fileId)){
    request.status='needs_attention';request.result={at,message:'The chosen CV is unavailable. Attach a CV before trying again.'};return null;
  }
  request.applicantProfile=applicationProfile(state);
  request.status='processing';request.claim={id:crypto.randomUUID(),at,expiresAt:new Date(Date.parse(at)+15*60_000).toISOString()};
  record(state,'application_agent_claim','The CV application agent started an authorized request.','agent',at);
  return request;
}
export function activeClaim(state:State,requestId:string,claimId:string,at=new Date().toISOString()){
  const request=state.applications?.find(item=>item.id===requestId&&item.agentVersion===2);
  if(!request||request.status!=='processing'||request.claim?.id!==claimId||Date.parse(request.claim.expiresAt)<=Date.parse(at))throw new DomainError('This claim is unavailable or expired. Check the employer outcome before retrying.',409);
  if(!request.cv||!state.attachments.some(file=>file.id===request.cv!.fileId))throw new DomainError('The CV for this claim is unavailable.',409);
  return request;
}
export function completeApplication(state:State,input:{requestId:string;claimId:string;status:'applied'|'needs_attention'|'uncertain'|'failed';message:string;receipt?:string;evidence?:{url:string;text:string};report?:Record<string,unknown>},at=new Date().toISOString()){
  const request=activeClaim(state,input.requestId,input.claimId,at);
  if(input.status==='applied'&&(!input.receipt||!input.evidence?.text.trim()||!safeJobUrl(input.evidence.url)))throw new DomainError('Applied requires an explicit employer confirmation and its URL.',409);
  request.status=input.status;request.result={at,message:input.message,...(input.receipt?{receipt:input.receipt}:{}),...(input.evidence?{evidence:input.evidence}:{})};
  if(input.report)request.report=input.report;
  record(state,'application_agent_result',`Application agent: ${input.status.replaceAll('_',' ')}. ${input.message}`,'agent',at);
  return request;
}

export function assertApplicationProfileCurrent(state:State,request:NonNullable<State['applications']>[number]){if(!request.applicantProfile||JSON.stringify(request.applicantProfile)!==JSON.stringify(applicationProfile(state)))throw new DomainError('Edit Profile changed during this application. Stop and update the application before submitting.',409);}
