import type {ApplicationRequest} from './cyber-domain';
import {employerQuestionKey,type EmployerQuestion} from './employer-questions';

/** Choices belong to an exact question and vacancy, not every employer's version. */
export function applicationQuestionChoices(application:ApplicationRequest,entry:Record<string,unknown>,memory:EmployerQuestion[]=[]){
 const key=employerQuestionKey(String(entry.question||''));
 const recorded=Array.isArray(application.report?.questions)?application.report.questions.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'):[];
 const field=recorded.find(row=>employerQuestionKey(String(row.question||''))===key);
 const profile=memory.find(row=>employerQuestionKey(row.question)===key&&(row.optionsJobId||row.jobId)===application.jobId&&row.options.length>0);
 const choices=(value:unknown)=>Array.isArray(value)?value.filter((v):v is string=>typeof v==='string').map(v=>v.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,100).map(v=>v.slice(0,200)):[];
 const direct=choices(entry.options),reported=choices(field?.options);
 const newerProfile=profile?.optionsCheckedAt&&Date.parse(profile.optionsCheckedAt)>Date.parse(application.result?.at||'');
 const options=newerProfile?choices(profile.options):direct.length?direct:reported.length?reported:choices(profile?.options);
 const kind=String(['select','combobox'].includes(String(field?.field_type))?field?.field_type:entry.field_type||field?.field_type||profile?.fieldType||'text');
 return {isDropdown:['select','combobox'].includes(kind),options,truncated:!!(newerProfile?profile?.optionsTruncated:direct.length?entry.optionsTruncated:reported.length?field?.optionsTruncated:profile?.optionsTruncated)};
}
