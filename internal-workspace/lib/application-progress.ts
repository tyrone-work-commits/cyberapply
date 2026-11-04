import type { ApplicationRequest } from './cyber-domain';

export type ProgressGroup = 'in_progress' | 'needs_you' | 'applied' | 'check_outcome';
type Step = {label:string;state:'done'|'current'|'pending'};
export type ApplicationProgress = {
  group:ProgressGroup;
  label:string;
  description:string;
  tone:'neutral'|'active'|'success'|'warning';
  canQueue:boolean;
  actionEvidence:string[];
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
  const possibleDelivery=!!application.report?.journey&&typeof application.report.journey==='object'&&(application.report.journey as Record<string,unknown>).possible_delivery===true;
  const checkOutcome=possibleDelivery&&!confirmed||status==='uncertain'||lostClaim||(status==='applied'&&!confirmed);
  const journey=application.report?.journey as Record<string,unknown>|undefined;
  const recordedJourney=journey&&journey.version===1;
  const count=(key:string)=>recordedJourney&&Number.isSafeInteger(journey[key])&&(journey[key] as number)>=0?journey[key] as number:null;
  const actionEvidence:string[]=recordedJourney?[
    journey.form_found===true?'Application form located.':'Application form not recorded as located.',
    journey.cv_attached===true?'Chosen CV attached in the form.':'CV attachment not recorded.',
    count('continue_click_attempts')!==null?`Continue attempts: ${count('continue_click_attempts')}.`:'Continue attempts not recorded.',
    count('submit_click_attempts')!==null?`Submit attempts: ${count('submit_click_attempts')}.`:'Submit attempts not recorded.',
    confirmed?'Employer confirmation recorded.':'Employer confirmation not recorded.',
  ]:application.result?['This older report does not record each browser action. Its status alone does not prove that the form was filled or submitted.']:[];
  const canQueue=['needs_action','needs_attention','failed'].includes(status)&&!!application.cv?.fileId&&
    !['materials_changed','cv_required','candidate_review_required'].includes(application.reason);
  let group:ProgressGroup='needs_you',label='Needs you',description='Review this request, then queue the application agent when you are ready.';
  let tone:ApplicationProgress['tone']='neutral';
  if(confirmed){
    group='applied';label='Applied';tone='success';description='Employer confirmation is recorded. Review the confirmation details below.';
  }else if(checkOutcome){
    group='check_outcome';label='Awaiting confirmation';tone='neutral';
    description=lostClaim?'The agent stopped reporting before an outcome was confirmed. Check the employer website or inbox before trying again.':
      status==='applied'?'This saved record has no confirmation evidence. Check the employer website or inbox to establish its outcome.':
      'The employer may have received all or part of this application. Check the employer website or inbox before trying again.';
    if(/six-step limit/i.test(application.result?.message||''))description='The previous runner stopped at its form-navigation limit. This report does not establish that Submit was clicked. The outcome remains unverified; check the employer website or inbox before any retry.';
  }else if(status==='queued'){
    group='in_progress';label='Queued';tone='active';description=application.reason==='daily_limit'?'Your daily agent-run allowance is used. This queued request can continue after the UTC day changes.':'Waiting for your browser runner to pick up this request. Keep the runner open on your computer.';
  }else if(status==='processing'){
    group='in_progress';label='Agent working';tone='active';description='The agent has claimed this request and is working through the employer form. Submission is not confirmed yet.';
  }else if(!application.cv||application.reason==='cv_required'){
    label='Choose a CV';description='Choose an uploaded CV and attach it to this request before queuing the agent.';
  }else if(application.reason==='materials_changed'||application.reason==='candidate_review_required'){
    label='Update request';description='Review the chosen CV and update this request before queuing the agent.';
  }else if(application.reason==='review_required'){label='Review before applying';description='Review the chosen CV and saved materials, then start the agent for this request when you are ready.';
  }else if(application.reason==='daily_limit'){label='Daily limit reached';description='Your daily agent-run allowance is used. Continue after the UTC day changes.';
  }else if(application.reason==='below_minimum_match'){label='Below your match setting';description='This CV does not establish the minimum keyword match you chose. Review the CV or lower the setting if appropriate.';
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
  return {group,label,description,tone,canQueue:!checkOutcome&&canQueue,actionEvidence,steps,events};
}
