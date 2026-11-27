import type {State} from './cyber-domain';
import {manualDisplaySession,type ManualBrowserHealth} from './manual-submission';
import {currentHandoff} from './verification-handoff';

export type DesktopNotice={key:string;kind:'input'|'submit';company:string;role:string;reason?:'browser_session'};
/** Owner-authenticated heartbeat metadata only; never changes a form or request. */
export function desktopNotices(state:State,now=Date.now(),health?:Record<string,ManualBrowserHealth>):DesktopNotice[]{
 const notices:DesktopNotice[]=[];
 for(const item of state.applications||[]){
  const manual=manualDisplaySession(item),handoff=currentHandoff(item,now);
  let kind:DesktopNotice['kind']|undefined,version='';
  let reason:DesktopNotice['reason'];
  if(manual&&['ready','needs_submit'].includes(manual.state)&&health?.[item.id]?.state==='not_reporting'){
   kind='input';version=`browser_lost:${manual.id}`;reason='browser_session';
  }else if(manual?.verificationStage==='email_code'){
   kind='input';version=`email_verification:${manual.id}`;
  }else if(manual?.processingError){
   kind='input';version=`submission_error:${manual.id}`;
  }else if(manual&&['ready','needs_submit','closed_before_submit'].includes(manual.state)){
   kind='submit';version=`manual:${manual.id}:${manual.state}`;
  }else if(handoff&&['waiting','opening','opened'].includes(handoff.state)){
   kind='input';version=`handoff:${handoff.id}`;
  }else if(item.status==='needs_attention'){
   kind='input';version=`answers:${item.claim?.id||item.result?.at||item.at}`;
  }
  if(!kind)continue;
  const job=state.jobs.find(job=>job.id===item.jobId);
  notices.push({key:`${item.id}|${version}`,kind,company:(job?.company||'Employer').slice(0,120),role:(job?.title||'Job application').slice(0,180),...(reason?{reason}:{})});
  if(notices.length===100)break;
 }
 return notices;
}
