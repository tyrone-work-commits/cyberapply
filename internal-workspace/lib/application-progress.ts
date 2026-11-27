import {currentHandoff,persistentQuestionHandoff} from './verification-handoff';
import type { ApplicationRequest } from './cyber-domain';
import {manualDisplaySession,type ManualBrowserHealth} from './manual-submission';

export type ProgressGroup = 'in_progress' | 'needs_you' | 'submit_yourself' | 'applied' | 'check_outcome';
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
export function applicationProgress(application:ApplicationRequest,now=Date.now(),browserHealth?:ManualBrowserHealth):ApplicationProgress{
  const status=application.status;
  const confirmed=status==='applied'&&hasConfirmation(application);
  const expiresAt=Date.parse(application.claim?.expiresAt||'');
  const manual=manualDisplaySession(application);
  const h=application.verificationHandoff;
  const persistentVerification=!!persistentQuestionHandoff(application);
  const lostClaim=status==='processing'&&!manual&&!persistentVerification&&(!Number.isFinite(expiresAt)||expiresAt<=now);
  const possibleDelivery=!!application.report?.journey&&typeof application.report.journey==='object'&&(application.report.journey as Record<string,unknown>).possible_delivery===true;
  const checkOutcome=!manual&&(possibleDelivery&&!confirmed&&!persistentVerification||status==='uncertain'||lostClaim||(status==='applied'&&!confirmed));
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
  }else if(manual){
    group=manual.state==='reopening'?'in_progress':manual.state==='cancel_requested'?'needs_you':'submit_yourself';label=manual.state==='needs_submit'?'Needs you: submit':manual.state==='cancel_requested'?'Cancellation requested':'Ready – submit it yourself';tone='warning';description='Open the CyberApply browser window and press Submit. Complete any reCAPTCHA yourself. The same form stays open until you submit or cancel; the agent never retries Submit.';
    if(manual.processingError){label='Employer submission error';description='The employer displayed an application-processing error. The outcome is unverified. The exact browser remains open; check for employer confirmation before any retry. CyberApply never retries Submit.';}
    if(manual.state==='closed_after_error'){label='Retry available after employer error';description='The browser ended after a submission error without saved confirmation. You can explicitly authorize another attempt below. The first attempt may still have reached the employer; no retry happens automatically.';}
    if(manual.state==='closed_before_submit')description='The browser closed before any recorded Continue or Submit. Confirm you closed before submitting to reopen and refill this application with the original CV and saved answers.';
    if(manual.state==='reopening'&&manual.retryAfterErrorAt){label=status==='queued'?'Waiting for browser runner':'Preparing your chosen retry';description='You explicitly authorized another attempt after an employer error. The earlier attempt remains in history. The replacement stays hidden until Open and final Submit stays manual.';}
    else if(manual.state==='reopening'){label=status==='queued'?'Waiting for browser runner':'Reopening your unsent form';description=status==='queued'?'Safe recovery is queued, but the background runner has not picked it up yet. Keep the runner computer awake and connected; check agent setup if it is stopped.':'The runner has picked up this same unsent application and is preparing its replacement. Final Submit remains manual.';}
    if(['ready','needs_submit'].includes(manual.state)&&browserHealth){
      if(browserHealth.state==='checking'){label='Checking browser session';description='Checking whether this exact filled application browser is still connected.';}
      else if(browserHealth.state==='not_reporting'){label='Browser session disconnected';description='This exact application browser is no longer reporting. A running agent does not restore an old browser’s memory. Your CV and saved answers remain; do not submit again while the outcome is uncertain.';}
      else if(browserHealth.open==='failed'){label='Browser did not open';description='The browser reported that it could not show its window. Check its connection below; no new application was started.';}
      else if(browserHealth.open==='timed_out'){label='Waiting for browser confirmation';description='The Open acknowledgement is delayed. Chrome may already be open; this is not a confirmed failure. The app is still checking the same browser, without restarting the application.';}
      else if(browserHealth.open==='pending'){label='Opening browser';description='Your Open request was saved. Waiting for this exact browser to confirm it opened.';}
    }
  }else if(checkOutcome){
    group='check_outcome';label='Awaiting confirmation';tone='neutral';
    description=lostClaim?'The agent stopped reporting before an outcome was confirmed. Check the employer website or your email account before trying again.':
      status==='applied'?'This saved record has no confirmation evidence. Check the employer website or your email account to establish its outcome.':
      'The employer may have received all or part of this application. Check the employer website or your email account before trying again.';
    if(/six-step limit/i.test(application.result?.message||''))description='The previous runner stopped at its form-navigation limit. This report does not establish that Submit was clicked. The outcome remains unverified; check the employer website or your email account before any retry.';
  }else if(status==='queued'){
    group='in_progress';label='Queued';tone='active';description='Waiting for your browser runner to pick up this request. Keep the runner open on your computer.';
  }else if(status==='processing'){
    group='in_progress';label='Agent working';tone='active';description='The agent has claimed this request and is working through the employer form. Submission is not confirmed yet.';
    const h=application.verificationHandoff;
    if(currentHandoff(application,now)?.kind==='input'){label=h?.state==='resuming'?'Resuming with your input':'Your input needed';tone='warning';description='The agent is paused in the same filled browser. Choose Watch live or Open exact agent browser, fill the requested fields personally, then Return control to agent.';}
    if(h&&h.kind==='question'&&!h.challengeHosts.length&&!h.approvedHosts.length&&h.questions.length>0&&h.questions.every(q=>/^which(?: of (?:the )?following)? best describes you\b/i.test(q.trim().replace(/\s+/g,' ')))&&h.claimId===application.claim?.id&&(persistentVerification||Date.parse(h.expiresAt)>now)&&['waiting','opening','opened','resuming'].includes(h.state)){
      label=h.state==='resuming'?'Resuming after verification':'Verification paused';tone='warning';description='The exact employer browser is waiting for you. Use Open exact agent browser, answer personally, then Return control to agent. The same session, filled fields and chosen CV remain in memory; a separate employer tab cannot resume it.';
    }
    if(h&&h.kind==='recaptcha'&&h.questions.length===1&&h.questions[0]==='Complete the employer reCAPTCHA in this browser.'&&h.challengeHosts.every(host=>['www.google.com','www.recaptcha.net','www.gstatic.com','recaptcha.google.com'].includes(host))&&h.claimId===application.claim?.id&&Date.parse(h.expiresAt)>now&&['waiting','opening','opened','resuming'].includes(h.state)){
      label=h.state==='resuming'?'Checking after reCAPTCHA':'reCAPTCHA needs you';tone='warning';description=h.phase==='after_submit'?'Complete only the employer verification in the exact agent browser. Submit was already clicked once; the agent will check that attempt without repeating it.':'The agent needs you to permit the employer reCAPTCHA connection and complete any visible check personally in its existing browser.';
    }
  }else if(!application.cv||application.reason==='cv_required'){
    label='Choose a CV';description='Choose an uploaded CV and attach it to this request before queuing the agent.';
  }else if(application.reason==='materials_changed'||application.reason==='candidate_review_required'){
    label='Update request';description='Review the chosen CV and update this request before queuing the agent.';
  }else if(application.reason==='authorization_required'){label='Authorize Automatic Apply';description='Open application settings and authorize Automatic Apply. No employer form has been submitted for this request.';
  }else if(application.reason==='review_required'){label='Previous request paused';description='This saved request is paused. Continue the automatic application when its saved details and outstanding questions are ready.';
  }else if(application.reason==='daily_limit'){label='Ready to continue';description='Daily application-run limits have been removed. Continue this unsent request when you are ready.';
  }else if(application.reason==='below_minimum_match'){label='Below your match setting';description='This CV does not establish the minimum keyword match you chose. Review the CV or lower the setting if appropriate.';
  }else if(status==='needs_attention'){
    label='Needs your input';tone='warning';if(Array.isArray(application.report?.unresolved)&&application.report.unresolved.some(item=>item&&typeof item==='object'&&(item as Record<string,unknown>).source==='generated')){label='Approval needed';}
    description='The agent paused this unsent application. Review its questions and preparation report, then approve and save answers to continue automatically.';
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
  return {group,label,description,tone,canQueue:!manual&&!checkOutcome&&canQueue,actionEvidence,steps,events};
}
