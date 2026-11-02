import type {State,ApplicationRequest} from './cyber-domain';
export type EmployerQuestion={id:string;question:string;fieldType:string;answer:string;source:'cv'|'cv_and_job'|'edit_profile'|'user'|'missing';evidence:string;status:'answered'|'needs_details';jobSpecific:boolean;jobId:string;originRequestId?:string;cvSha256?:string;updatedAt:string;options:string[];jobTitle?:string;company?:string;reusePolicy?:'exact_question'|'job_only'|'manual_only'};
export const isAutomationCheck=(question:string,choices:string[]=[])=>[question,...choices].some(text=>/\b(?:are you (?:a |an )?(?:human|robot|bot)|i am (?:a |an )?(?:human|ai|robot|bot|automated program)|(?:verify|confirm|prove) (?:that )?you(?: are|'re) (?:a )?human|captcha)\b/i.test(text));
export const questionNeedsDirectFacts=(q:string)=>/\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|authori[sz]|visa|sponsor|citizen|nationality|right to work|salary|compensation|wage|clearance|criminal|convict|gender|race|ethnic|religion|disabil|veteran|birth|age|password|captcha|verification|security code)\w*\b/i.test(q);
export const manualAnswerOnly=(question:string,choices:string[]=[])=>isAutomationCheck(question,choices)||/\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|password|captcha|verification|security code)\w*\b/i.test(question)||/\bauthori[sz]\w*\b.*\b(?:process|store|share|collect|retain|contact|personal data)\b/i.test(question);
export const jobBoundAnswer=(question:string)=>/\b(?:salary|compensation|remuneration|wage|pay|this (?:role|position|job|company|country)|country (?:in )?which|country.*(?:applying|posted))\b/i.test(question);
export const employerQuestionKey=(q:string)=>q.replace(/\s+/g,' ').trim().replace(/[\s*]+$/,'').toLowerCase();
export const answerControlGroup=(kind:string)=>['select','radio','combobox','checkbox'].includes(kind)?'choice':['text','textarea'].includes(kind)?'text':kind;
const key=employerQuestionKey;
export function rememberEmployerQuestions(state:State,request:ApplicationRequest,report:Record<string,unknown>,at:string){
 if(!state.accountProfile)return;
 const prior=state.accountProfile.employerQuestions||[],bank=structuredClone(prior);
 const answers=(Array.isArray(report.answers)?report.answers:[]) as Record<string,unknown>[];
 const unresolved=(Array.isArray(report.unresolved)?report.unresolved:[]) as Record<string,unknown>[];
 const questions=(Array.isArray(report.questions)?report.questions:[...answers,...unresolved]) as Record<string,unknown>[];
 const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
 const budget=1650000-bytes(state)+bytes(prior);let used=bytes(bank),saved=0,omitted=0;
 const job=state.jobs.find(job=>job.id===request.jobId);
 for(const row of questions){
  const question=String(row.question||'').trim(),fieldType=String(row.field_type||'text');
  if(!question||question.length>4000||/unlabelled field/i.test(question)||['file','password','hidden'].includes(fieldType)||/password|captcha|verification code|security code/i.test(question))continue;
  const scoped=jobBoundAnswer(question)||/why|this role|this position|company|cover.?letter|contribut|motivat/i.test(question);
  const old=bank.find(item=>item.source==='user'&&key(item.question)===key(question)&&answerControlGroup(item.fieldType)===answerControlGroup(fieldType))||bank.find(item=>key(item.question)===key(question)&&item.fieldType===fieldType&&(!scoped||item.jobId===request.jobId));
  if(old?.source==='user')continue;
  const answer=answers.find(a=>key(String(a.question||''))===key(question));
  const source=answer&&['cv','cv_and_job','edit_profile'].includes(String(answer.source))?answer.source as EmployerQuestion['source']:'missing';
  const value=answer&&typeof answer.value==='string'?answer.value.slice(0,2000):'';
  const item:EmployerQuestion={id:old?.id||crypto.randomUUID(),question,fieldType,answer:value,source,evidence:answer?String(answer.evidence||'').slice(0,600):'Not established by the chosen CV or Account Profile.',status:value?'answered':'needs_details',jobSpecific:scoped,jobId:request.jobId,jobTitle:job?.title,company:job?.company,originRequestId:request.id,cvSha256:request.cvSha256,updatedAt:at,options:Array.isArray(row.options)?row.options.filter((v):v is string=>typeof v==='string').slice(0,15).map(v=>v.slice(0,200)):[]};
  const size=used-(old?bytes(old):0)+bytes(item)+(!old&&bank.length?1:0);
  if(size>budget){omitted++;continue;}
  if(old)bank.splice(bank.indexOf(old),1);
  bank.unshift(item);used=size;saved++;
 }
 state.accountProfile.employerQuestions=bank;
 report.answerMemory={saved,omitted};
}
