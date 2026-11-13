import {employerChoiceLimit} from './employer-location-choices';
import {DomainError,record,type State,type Job} from './cyber-domain';
import {rememberEmployerQuestions,employerQuestionKey} from './employer-questions';
import {jsonFeed} from './job-discovery';

export async function fetchEmployerQuestions(job:Job,fetcher:typeof fetch=fetch){
 const source=job.source;
 if(source?.provider!=='greenhouse'||!/^\w[\w-]{0,79}$/.test(source.board)||!/^\d{1,30}$/.test(source.externalId))throw new DomainError('This employer does not offer a supported public question feed. The browser agent will save the choices it can read from the form.',409);
 const data=await jsonFeed(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs/${source.externalId}?questions=true`,fetcher,AbortSignal.timeout(10000));
 if(String(data?.id)!==source.externalId||!Array.isArray(data.questions))throw new DomainError('The employer did not return questions for this exact vacancy.',502);
 const rows:Record<string,unknown>[]=[];
 for(const q of [...data.questions,...(Array.isArray(data.location_questions)?data.location_questions:[]),...(Array.isArray(data.compliance)?data.compliance:[])].slice(0,100)){
  if(!q||typeof q.label!=='string'||!Array.isArray(q.fields))continue;
  // A resume question can offer both a file and text control. Do not learn it as prose.
  if(q.fields.some((f:Record<string,unknown>)=>f?.type==='input_file'))continue;
  for(const field of q.fields.filter((f:Record<string,unknown>)=>['input_text','textarea','multi_value_single_select','multi_value_multi_select'].includes(String(f?.type))).slice(0,5)){
  const values=Array.isArray(field.values)?field.values:[],limit=employerChoiceLimit(q.label);
  rows.push({question:q.label.trim().slice(0,4000),field_type:field.name==='phone'?'tel':field.type==='textarea'?'textarea':field.type==='multi_value_single_select'?'combobox':field.type==='multi_value_multi_select'?'checkbox':'text',options:values.filter((v:Record<string,unknown>)=>typeof v?.label==='string').map((v:{label:string})=>v.label).slice(0,limit),optionsTruncated:values.length>limit});
  }
 }
 return rows.slice(0,100);
}

/** Refresh only exact-vacancy question metadata, never answers or submission state. */
export function mergeApplicationQuestionChoices(state:State,applicationId:string,rows:Record<string,unknown>[],at:string,source:'employer_question_feed'|'browser_read_only'='employer_question_feed'){
 const request=state.applications?.find(a=>a.id===applicationId);
 if(!request)throw new DomainError('This application is no longer available.',404);
 if(request.status==='processing')throw new DomainError('The agent is currently reading this form. Wait for its report before refreshing choices.',409);
 const questions=Array.isArray(request.report?.questions)?structuredClone(request.report.questions) as Record<string,unknown>[]:[];
 let refreshed=0,omitted=0;
 for(const row of rows.slice(0,100)){
  if(!['select','combobox'].includes(String(row.field_type))||!Array.isArray(row.options)||!row.options.length)continue;
  const options=[...new Set(row.options.filter((v):v is string=>typeof v==='string').map(v=>v.replace(/\s+/g,' ').trim().slice(0,200)).filter(Boolean))].slice(0,employerChoiceLimit(String(row.question||'')));
  if(!options.length)continue;
  const key=employerQuestionKey(String(row.question||''));if(!key)continue;
  const existing=questions.find(q=>employerQuestionKey(String(q.question||''))===key&&['select','combobox'].includes(String(q.field_type)));
  const update={...row,options,optionsCheckedAt:at,optionsSource:source};
  if(existing)Object.assign(existing,update);else if(questions.length<200)questions.push(update);else{omitted++;continue;}
  refreshed++;
 }
 request.report={...request.report,questions};
 rememberEmployerQuestions(state,request,{questions:rows},at,true);
 const message=`Refreshed ${refreshed} employer dropdown ${refreshed===1?'menu':'menus'} for this vacancy.${omitted?` ${omitted} additional menus could not fit in the question catalogue.`:''} Existing answers and application status are unchanged; nothing was queued or submitted. Search-dependent menus are captured by the browser agent when their choices are available.`;
 record(state,'refresh_application_question_choices',message,'interface',at);
 return message;
}

export function mergeEmployerQuestionChoices(state:State,questionId:string,rows:Record<string,unknown>[],at:string){
 const question=state.accountProfile?.employerQuestions?.find(q=>q.id===questionId);
 if(!question)throw new DomainError('That saved question is no longer available.',404);
 const request=state.applications?.find(a=>a.jobId===question.jobId);
 if(!request)throw new DomainError('The original application is no longer available.',404);
 const report:Record<string,unknown>={questions:rows};
 rememberEmployerQuestions(state,request,report,at,true);
 // The public feed may describe a phone input as plain text while the browser
 // reports it as tel. Retain an established answer instead of an empty duplicate.
 const bank=state.accountProfile!.employerQuestions!,freeText=(kind:string)=>['text','textarea','tel','email','url'].includes(kind);
 for(let i=bank.length-1;i>=0;i--){const q=bank[i];if(q.source==='missing'&&!q.answer&&!q.options.length&&freeText(q.fieldType)&&bank.some(other=>other.id!==q.id&&other.jobId===q.jobId&&!!other.answer&&freeText(other.fieldType)&&employerQuestionKey(other.question)===employerQuestionKey(q.question)))bank.splice(i,1);}
 const counts=report.answerMemory as {saved:number;omitted:number};
 const message=`Refreshed employer questions and choices in Answers library (${counts.saved} updated${counts.omitted?`, ${counts.omitted} could not fit`:''}). Your existing answers are unchanged. No application was queued or submitted.`;
 record(state,'refresh_employer_question_choices',message,'interface',at);
 return message;
}
