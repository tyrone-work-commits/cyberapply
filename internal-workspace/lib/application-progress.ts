import type { ApplicationRequest } from './cyber-domain';

export type ProgressGroup = 'in_progress' | 'needs_you' | 'applied' | 'check_outcome';
type Step = {label:string;state:'done'|'current'|'pending'};
export type ApplicationProgress = {
  group:ProgressGroup;
  label:string;
  description:string;
  tone:'neutral'|'active'|'success'|'warning';
  canQueue:boolean;
  steps:Step[];
  events:{label:string;at:string}[];
};

function hasConfirmation(application:ApplicationRequest){
  if(application.result?.receipt?.trim())return true;
  const evidence=application.result?.evidence;
  if(!evidence?.text.trim())return false;
  try{const url=new URL(evidence.url);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
}

/** Presentation only: this never changes a saved outcome or authorizes a retry. */
export function applicationProgress(application:ApplicationRequest,now=Date.now()):ApplicationProgress{
  const status=application.status;
  const confirmed=status==='applied'&&hasConfirmation(application);
  const expiresAt=Date.parse(application.claim?.expiresAt||'');
  const lostClaim=status==='processing'&&(!Number.isFinite(expiresAt)||expiresAt<=now);
  const checkOutcome=status==='uncertain'||lostClaim||(status==='applied'&&!confirmed);
  const canQueue=['needs_action','needs_attention','failed'].includes(status)&&!!application.cv?.fileId&&
    !['materials_changed','cv_required','candidate_review_required'].includes(application.reason);
  let group:ProgressGroup='needs_you',label='Needs you',description='Review this request, then queue the application agent when you are ready.';
  let tone:ApplicationProgress['tone']='neutral';
  if(confirmed){
    group='applied';label='Applied';tone='success';description='Employer confirmation is recorded. Review the confirmation details below.';
  }else if(checkOutcome){
    group='check_outcome';label='Check outcome';tone='warning';
    description=lostClaim?'The agent stopped reporting before an outcome was confirmed. Check the employer website or inbox before trying again.':
      status==='applied'?'This saved record has no confirmation evidence. Check the employer website or inbox to establish its outcome.':
      'The employer may have received all or part of this application. Check the employer website or inbox before trying again.';
  }else if(status==='queued'){
    group='in_progress';label='Queued';tone='active';description='Waiting for your browser runner to pick up this request. Keep the runner open on your computer.';
  }else if(status==='processing'){
    group='in_progress';label='Agent working';tone='active';description='The agent has claimed this request and is working through the employer form. Submission is not confirmed yet.';
  }else if(!application.cv||application.reason==='cv_required'){
    label='Choose a CV';description='Choose an uploaded CV and attach it to this request before queuing the agent.';
  }else if(application.reason==='materials_changed'||application.reason==='candidate_review_required'){
    label='Update request';description='Review the chosen CV and update this request before queuing the agent.';
  }else if(status==='needs_attention'){
    label='Needs your input';tone='warning';if(Array.isArray(application.report?.unresolved)&&application.report.unresolved.some(item=>item&&typeof item==='object'&&(item as Record<string,unknown>).source==='generated')){label='Approval needed';}
    description='The agent paused this unsent application. Review its questions and preparation report, save any answers you can confirm, then queue it again.';
  }else if(status==='failed'){
    label='Needs review';tone='warning';description='The agent could not finish this form. Review its report before trying again.';
  }
  const agentStarted=!!application.claim?.at;
  const steps:Step[]=[
    {label:'Requested',state:confirmed||checkOutcome||agentStarted?'done':'current'},
    {label:'Agent working',state:confirmed?'done':checkOutcome||agentStarted?'current':'pending'},
    {label:'Employer confirmation',state:confirmed?'done':checkOutcome?'current':'pending'},
  ];
  // An unknown outcome is a confirmation check, not proof of completed agent work.
  if(checkOutcome)steps[1].state='pending';
  const events:{label:string;at:string}[]=[];
  const add=(eventLabel:string,at?:string)=>{if(at&&Number.isFinite(Date.parse(at)))events.push({label:eventLabel,at});};
  add('Apply requested',application.at);
  add('Agent started',application.claim?.at);
  if(application.result)add(confirmed?'Employer confirmation recorded':checkOutcome?'Outcome needs checking':status==='needs_attention'?'Agent requested your input':'Agent update recorded',application.result.at);
  events.sort((first,second)=>Date.parse(first.at)-Date.parse(second.at));
  return {group,label,description,tone,canQueue:!checkOutcome&&canQueue,steps,events};
}
