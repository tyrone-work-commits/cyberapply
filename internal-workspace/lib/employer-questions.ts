import type {State,ApplicationRequest} from './cyber-domain';
export type EmployerQuestion={id:string;question:string;fieldType:string;answer:string;source:'cv'|'cv_and_job'|'edit_profile'|'user'|'missing';evidence:string;status:'answered'|'needs_details';jobSpecific:boolean;jobId:string;originRequestId?:string;cvSha256?:string;updatedAt:string;options:string[];jobTitle?:string;company?:string;aiDraft?:boolean;generationNote?:string;reusePolicy?:'exact_question'|'job_only'|'manual_only'};
export const isAutomationCheck=(question:string,choices:string[]=[])=>[question,...choices].some(text=>/\b(?:are you (?:a |an )?(?:human|robot|bot)|i am (?:a |an )?(?:human|ai|robot|bot|automated program)|(?:verify|confirm|prove) (?:that )?you(?: are|'re) (?:a )?human|captcha)\b/i.test(text));
export const questionNeedsDirectFacts=(q:string)=>/\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|authori[sz]|visa|sponsor|citizen|nationality|right to work|salary|compensation|wage|clearance|criminal|convict|gender|race|ethnic|religion|disabil|veteran|birth|age|password|captcha|verification|security code)\w*\b/i.test(q);
export const authorshipCheck=(question:string)=>{const text=question.replace(/\s+/g,' ');return /\b(?:confirm|certify|attest|declare|acknowledge)\b.{0,100}\b(?:AI|ChatGPT|own words|original work|independently written)\b/i.test(text)||/^(?:(?:did|have) you (?:ever )?(?:use|used)\b|(?:was|were|is|are) (?:any of )?(?:your|this|the|these|all) (?:application|answers?|responses?|submission|cover.?letter)\b)/i.test(text)&&/\b(?:AI|ChatGPT)\b/i.test(text)&&/\b(?:application|answers?|responses?|submission|cover.?letter)\b/i.test(text);};
export const manualAnswerOnly=(question:string,choices:string[]=[])=>authorshipCheck(question)||isAutomationCheck(question,choices)||/\b(?:consent|agree|accept|acknowledg|attest|certify|privacy|terms|permission|password|captcha|verification|security code)\w*\b/i.test(question)||/\bauthori[sz]\w*\b.*\b(?:process|store|share|collect|retain|contact|personal data)\b/i.test(question);
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
  const item:EmployerQuestion={id:old?.id||crypto.randomUUID(),question,fieldType,answer:value,source,evidence:answer?String(answer.evidence||'').slice(0,600):'Not established by the chosen CV or Account Profile.',status:value?'answered':'needs_details',aiDraft:source==='cv_and_job',jobSpecific:scoped,jobId:request.jobId,jobTitle:job?.title,company:job?.company,originRequestId:request.id,cvSha256:request.cvSha256,updatedAt:at,options:Array.isArray(row.options)?row.options.filter((v):v is string=>typeof v==='string').slice(0,15).map(v=>v.slice(0,200)):[]};
  const size=used-(old?bytes(old):0)+bytes(item)+(!old&&bank.length?1:0);
  if(size>budget){omitted++;continue;}
  if(old)bank.splice(bank.indexOf(old),1);
  bank.unshift(item);used=size;saved++;
 }
 state.accountProfile.employerQuestions=bank;
 report.answerMemory={saved,omitted};
}

export function openEndedQuestion(question:string,kind:string){
 if(!['text','textarea'].includes(kind)||manualAnswerOnly(question)||questionNeedsDirectFacts(question)||/\b(?:email|phone|address|location|city|country|postal|zip|salary|compensation|github|linkedin|portfolio|date|years?|months?|how many|referr(?:al|ed)|hear about|heard about|favo(?:u)?rite|hobb(?:y|ies))\b/i.test(question))return false;
 return /\b(?:why|describe|explain|tell|summari[sz]e|outline|approach|contribut|interested|interest|strength|challenge|motivat|anything else|work experience|relevant experience|professional summary|about (?:you|yourself)|personal statement|additional (?:information|info)|what|how)\w*\b/i.test(question);
}
// PDF text wraps inside bullets and paragraphs. Reassemble each evidence statement
// before ranking it; a physical line is not necessarily a complete claim.
function cvEvidenceStatements(cv:string){
 const action=/\b(?:built|developed|configured|monitored|investigated|analy[sz]ed|managed|deployed|used|performed|conducted|secured|audited|supported|responded|triaged|tested|implemented|automated|assessed|designed|documented)\b/i;
 const statements:string[]=[];let pending='';
 const flush=()=>{if(pending)statements.push(pending);pending='';};
 for(const raw of cv.split(/\r?\n/)){
  const line=raw.replace(/\s+/g,' ').trim(),bullet=/^[-•*]\s+/.test(line),text=line.replace(/^[-•*]\s+/,'');
  if(!text||/^[A-Z\s&/()-]+$/.test(text)||(!bullet&&/^[^:.!?]{1,70}:\s/.test(text))){flush();continue;}
  if(bullet||(!pending&&action.test(text))||action.exec(text)?.index===0){flush();pending=text;}
  else if(pending)pending+=(pending.endsWith('-')?'':' ')+text;
  if(/[.!?]$/.test(pending))flush();
 }
 flush();
 return statements.filter(line=>line.length>=20&&line.length<=500&&action.test(line)&&!/\b(?:no experience|never used|wish to|want to|learning to)\b/i.test(line)&&!/\b(?:and|or|with|using|to|for|of|the|a|an)\s*$/i.test(line));
}
export function draftEmployerProse(question:string,kind:string,cv:string,job:{title:string;company:string;description:string;skills:string[]}){
 if(!openEndedQuestion(question,kind))return {answer:'',evidence:'',reason:'Use your saved personal facts or your own factual answer for this question.'};
 const evidence=cvEvidenceStatements(cv);
 if(!evidence.length)return {answer:'',evidence:'',reason:'The selected CV does not contain enough work evidence to draft a reliable answer.'};
 const topic=/\bexperience\s+(?:with|in|using|as)\s+(.+?)[?.!]*$/i.exec(question)?.[1]?.trim();
 if(topic&&!evidence.some(line=>line.toLowerCase().includes(topic.toLowerCase())))return {answer:'',evidence:'',reason:'The selected CV does not establish the specific experience this question asks about. Add your own accurate answer.'};
 const words=new Set((question+' '+job.description).toLowerCase().match(/[a-z]{4,}/g)||[]);
 const ranked=[...evidence].sort((a,b)=>(b.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>words.has(w)).length-(a.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>words.has(w)).length).slice(0,2);
 const title=job.title.replace(/\s+/g,' ').slice(0,180),company=job.company.replace(/\s+/g,' ').slice(0,150);
 const normalizedCv=' '+cv.toLowerCase().replace(/[^a-z0-9#+.]+/g,' ')+' ';
 const skills=job.skills.filter(skill=>normalizedCv.includes(' '+skill.toLowerCase().replace(/[^a-z0-9#+.]+/g,' ').trim()+' ')).slice(0,4);
 const focus=skills.length>1?skills.slice(0,-1).join(', ')+' and '+skills.at(-1):skills[0]||'the responsibilities in the job posting';
 const why=/\b(?:why|interest|motivat)\w*\b/i.test(question);
 const intro=why?`I am interested in the ${title} role${company?' at '+company:''} because it connects my documented background with ${focus}.`:/\bhow (?:would|could|will)\b/i.test(question)?`For the ${title} role, I would start by understanding the team's priorities, reviewing the available evidence and agreeing on practical next steps.`:`A relevant part of my background for the ${title} role is the work described in my CV.`;
 const ending=why?'I would bring that experience to the team, learn its operating procedures and use the role’s priorities to guide where I can contribute.':'I would use that documented experience to guide my approach, validate assumptions with the team and communicate the work clearly.';
 const examples=ranked.map(line=>{
  const sentence=/^(?:built|developed|configured|monitored|investigated|analy[sz]ed|managed|deployed|used|performed|conducted|secured|audited|supported|responded|triaged|tested|implemented|automated|assessed|designed|documented)\b/i.test(line)?'I '+line[0].toLowerCase()+line.slice(1):'My CV describes this work: '+line;
  return /[.!?]$/.test(sentence)?sentence:sentence+'.';
 }).join(' ');
 return {answer:intro+'\n\n'+examples+'\n\n'+ending,evidence:ranked.join('; ').slice(0,600),reason:''};
}
