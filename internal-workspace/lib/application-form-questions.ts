import type {ApplicationRequest} from './cyber-domain';
import {employerQuestionKey,isAutomationCheck,type EmployerQuestion} from './employer-questions';

export const MAX_APPLICATION_QUESTIONS=200;
const dropdown=(kind:unknown)=>kind==='select'||kind==='combobox';
const rows=(value:unknown)=>Array.isArray(value)?value.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'):[];

/** Include every captured menu, not only the questions that paused the agent. */
export function applicationFormQuestions(application:ApplicationRequest,memory:EmployerQuestion[]=[]){
 const questions=new Map<string,Record<string,unknown>>();
 function add(row:Record<string,unknown>){
  const question=String(row.question||'').replace(/\s+/g,' ').trim().slice(0,4000),key=employerQuestionKey(question);
  if(!key||['hidden','password','file'].includes(String(row.field_type))||/unlabelled field|password|captcha|verification code|security code/i.test(question))return;
  if(!questions.has(key)&&questions.size<MAX_APPLICATION_QUESTIONS)questions.set(key,{...row,question});
 }
 rows(application.report?.unresolved).forEach(add);
 rows(application.report?.questions).filter(row=>dropdown(row.field_type)).forEach(add);
 // Oversized reports deliver their full catalog separately into owned memory.
 // Only metadata tied to this run/exact vacancy may fill an abbreviated report.
 for(const item of memory){
  if(!dropdown(item.fieldType)||(item.optionsJobId||item.jobId)!==application.jobId)continue;
  const currentRun=item.originRequestId===application.id||!!item.optionsCheckedAt&&Date.parse(item.optionsCheckedAt)>=Date.parse(application.at);
  if(currentRun)add({question:item.question,field_type:item.fieldType,options:item.options,optionsTruncated:!!item.optionsTruncated});
 }
 return [...questions.values()];
}

export function canEditApplicationQuestions(application:ApplicationRequest){
 const journey=application.report?.journey;
 return ['needs_action','needs_attention'].includes(application.status)&&!(journey&&typeof journey==='object'&&(journey as Record<string,unknown>).possible_delivery===true);
}

/** A saved profile answer does not complete an employer's verification check. */
export function applicationVerificationQuestions(application:ApplicationRequest,memory:EmployerQuestion[]=[]){
 const unresolved=rows(application.report?.unresolved),catalog=applicationFormQuestions(application,memory);
 return unresolved.filter(row=>{
  const question=String(row.question||''),key=employerQuestionKey(question);
  const offered=rows(application.report?.questions).find(q=>employerQuestionKey(String(q.question||''))===key&&Array.isArray(q.options)&&q.options.length)||catalog.find(q=>employerQuestionKey(String(q.question||''))===key);
  const choices=Array.isArray(offered?.options)?offered.options.filter((v):v is string=>typeof v==='string'):[];
  return row.source==='verification'||isAutomationCheck(question,choices);
 }).map(row=>String(row.question||'')).filter(Boolean);
}

export function applicationAnswerStage(application:ApplicationRequest,memory:EmployerQuestion[]=[]){
 if(['queued','processing'].includes(application.status))return 'in_progress' as const;
 if(!canEditApplicationQuestions(application))return 'reference' as const;
 return applicationVerificationQuestions(application,memory).length?'verification' as const:'editable' as const;
}

/** Durable acknowledgement of a CyberApply answer save, never an employer receipt. */
export function applicationAnswerSave(application:ApplicationRequest):{at:string;count:number|null}|null{
 if(!application.confirmedAnswers?.length)return null;
 const receipt=application.answerSave;
 if(receipt&&Number.isFinite(Date.parse(receipt.at))&&Number.isInteger(receipt.count)&&receipt.count>=1&&receipt.count<=MAX_APPLICATION_QUESTIONS)return receipt;
 // Older saves already have a server acknowledgement tied to this request.
 if(application.result?.message.startsWith('Your answers are saved.')&&Number.isFinite(Date.parse(application.result.at)))return {at:application.result.at,count:null};
 return null;
}
