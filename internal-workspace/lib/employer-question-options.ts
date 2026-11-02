import {DomainError,record,type State,type Job} from './cyber-domain';
import {rememberEmployerQuestions} from './employer-questions';
import {jsonFeed} from './job-discovery';

export async function fetchEmployerQuestions(job:Job,fetcher:typeof fetch=fetch){
 const source=job.source;
 if(source?.provider!=='greenhouse'||!/^\w[\w-]{0,79}$/.test(source.board)||!/^\d{1,30}$/.test(source.externalId))throw new DomainError('This employer does not offer a supported public question feed. The browser agent will save the choices it can read from the form.',409);
 const data=await jsonFeed(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs/${source.externalId}?questions=true`,fetcher,AbortSignal.timeout(10000));
 if(String(data?.id)!==source.externalId||!Array.isArray(data.questions))throw new DomainError('The employer did not return questions for this exact vacancy.',502);
 const rows:Record<string,unknown>[]=[];
 for(const q of [...data.questions,...(Array.isArray(data.compliance)?data.compliance:[])].slice(0,100)){
  if(!q||typeof q.label!=='string'||!Array.isArray(q.fields))continue;
  // A resume question can offer both a file and text control. Do not learn it as prose.
  if(q.fields.some((f:Record<string,unknown>)=>f?.type==='input_file'))continue;
  const field=q.fields.find((f:Record<string,unknown>)=>['input_text','textarea','multi_value_single_select','multi_value_multi_select'].includes(String(f?.type)));
  if(!field)continue;
  const values=Array.isArray(field.values)?field.values:[];
  rows.push({question:q.label.trim().slice(0,4000),field_type:field.type==='textarea'?'textarea':field.type==='multi_value_single_select'?'combobox':field.type==='multi_value_multi_select'?'checkbox':'text',options:values.filter((v:Record<string,unknown>)=>typeof v?.label==='string').map((v:{label:string})=>v.label),optionsTruncated:values.length>100});
 }
 return rows;
}

export function mergeEmployerQuestionChoices(state:State,questionId:string,rows:Record<string,unknown>[],at:string){
 const question=state.accountProfile?.employerQuestions?.find(q=>q.id===questionId);
 if(!question)throw new DomainError('That saved question is no longer available.',404);
 const request=state.applications?.find(a=>a.jobId===question.jobId);
 if(!request)throw new DomainError('The original application is no longer available.',404);
 const report:Record<string,unknown>={questions:rows};
 rememberEmployerQuestions(state,request,report,at,true);
 const counts=report.answerMemory as {saved:number;omitted:number};
 const message=`Refreshed employer questions and choices in Edit Profile (${counts.saved} updated${counts.omitted?`, ${counts.omitted} could not fit`:''}). Your existing answers are unchanged. No application was queued or submitted.`;
 record(state,'refresh_employer_question_choices',message,'interface',at);
 return message;
}
