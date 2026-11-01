import type {State,ApplicationRequest} from './cyber-domain';
export type EmployerQuestion={id:string;question:string;fieldType:string;answer:string;source:'cv'|'cv_and_job'|'edit_profile'|'user'|'missing';evidence:string;status:'answered'|'needs_details';jobSpecific:boolean;jobId:string;originRequestId?:string;cvSha256?:string;updatedAt:string;options:string[]};
export const questionNeedsDirectFacts=(q:string)=>/\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|authori[sz]|visa|sponsor|citizen|nationality|right to work|salary|compensation|wage|clearance|criminal|convict|gender|race|ethnic|religion|disabil|veteran|birth|age|password|captcha|verification|security code)\w*\b/i.test(q);
const key=(q:string)=>q.replace(/\s+/g,' ').trim().toLowerCase();
export function rememberEmployerQuestions(state:State,request:ApplicationRequest,report:Record<string,unknown>,at:string){
 if(!state.accountProfile)return;
 const prior=state.accountProfile.employerQuestions||[],bank=structuredClone(prior);
 const answers=(Array.isArray(report.answers)?report.answers:[]) as Record<string,unknown>[];
 const unresolved=(Array.isArray(report.unresolved)?report.unresolved:[]) as Record<string,unknown>[];
 const questions=(Array.isArray(report.questions)?report.questions:[...answers,...unresolved]) as Record<string,unknown>[];
 let saved=0,omitted=0;
 for(const row of questions.slice(0,100)){
  const question=String(row.question||'').trim(),fieldType=String(row.field_type||'text');
  if(!question||question.length>1000||/unlabelled field/i.test(question)||['file','password','hidden'].includes(fieldType)||/password|captcha|verification code|security code/i.test(question))continue;
  const old=bank.find(item=>key(item.question)===key(question)&&item.fieldType===fieldType);
  if(old?.source==='user')continue;
  const answer=answers.find(a=>key(String(a.question||''))===key(question));
  const source=answer&&['cv','cv_and_job','edit_profile'].includes(String(answer.source))?answer.source as EmployerQuestion['source']:'missing';
  const value=answer&&typeof answer.value==='string'?answer.value.slice(0,2000):'';
  const item:EmployerQuestion={id:old?.id||crypto.randomUUID(),question,fieldType,answer:value,source,evidence:answer?String(answer.evidence||'').slice(0,600):'Not established by the chosen CV or Account Profile.',status:value?'answered':'needs_details',jobSpecific:/why|this role|this position|company|cover.?letter|contribut|motivat/i.test(question),jobId:request.jobId,originRequestId:request.id,cvSha256:request.cvSha256,updatedAt:at,options:Array.isArray(row.options)?row.options.filter((v):v is string=>typeof v==='string').slice(0,15).map(v=>v.slice(0,200)):[]};
  if(old)bank.splice(bank.indexOf(old),1);
  bank.unshift(item);
  if(bank.length>40)bank.pop();saved++;
 }
 if(new TextEncoder().encode(JSON.stringify(bank)).length>60000||new TextEncoder().encode(JSON.stringify(state)).length+new TextEncoder().encode(JSON.stringify(bank)).length>1770000){omitted=saved;saved=0;}else state.accountProfile.employerQuestions=bank;
 report.answerMemory={saved,omitted};
}
