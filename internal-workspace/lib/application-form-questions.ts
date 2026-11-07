import type {ApplicationRequest} from './cyber-domain';
import {employerQuestionKey,type EmployerQuestion} from './employer-questions';

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
