import type {AccountProfile,ApplicantProfile,ApplicationRequest} from './cyber-domain';
import {answerControlGroup,authorshipCheck,employerQuestionKey,isAutomationCheck,manualAnswerOnly,type EmployerQuestion} from './employer-questions';
import {canEditApplicationQuestions} from './application-form-questions';
import {extractCandidateFacts} from './candidate-facts';
import {convertUsdSalary} from './expected-salary';

export type AnswerPrefill={value:string;source:'confirmed'|'recorded'|'profile'|'library'|'cv'|'suggestion'|''};
type Choice={isDropdown:boolean;options:string[]};
const clean=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim().replace(/[.*]+$/,'').toLowerCase();
const country=(value:string)=>{
 const key=clean(value).replace(/[.]/g,'');
 if(['us','usa','united states','united states of america'].includes(key))return 'usa';
 if(['uk','united kingdom','great britain'].includes(key))return 'uk';
 if(['ie','ireland','republic of ireland'].includes(key))return 'ireland';
 if(['ca','canada'].includes(key))return 'canada';
 return key;
};
const single=(values:string[])=>values.length===1?values[0]:'';
/** Return the actual offered label, never a made-up option or an arbitrary first choice. */
export function offeredAnswer(value:string,choices:Choice,question:string,profile?:AccountProfile|ApplicantProfile){
 if(!value.trim())return '';
 if(!choices.isDropdown)return value;
 if(choices.options.includes(value))return value;
 const exact=choices.options.filter(option=>clean(option)===clean(value));if(exact.length)return single(exact);
 if(/^(?:yes|no)$/i.test(value.trim()))return single(choices.options.filter(option=>new RegExp('^'+value.trim()+'(?:$|[\\s,.—–-])','i').test(option.trim())));
 if(/\bcountry\b/i.test(question)&&!/(?:phone|calling|dial)/i.test(question))return single(choices.options.filter(option=>country(option)===country(value)));
 if(/^(?:location\s*\(?\s*city\)?|city|town)\s*\*?$/i.test(question.trim())&&profile?.city&&profile.state&&profile.country){
  return single(choices.options.filter(option=>{const parts=option.split(',').map(clean);return parts[0]===clean(profile.city!)&&parts.slice(1).includes(clean(profile.state!))&&parts.slice(1).some(part=>country(part)===country(profile.country!));}));
 }
 return '';
}
function profileValue(question:string,entry:Record<string,unknown>,profile?:AccountProfile|ApplicantProfile):{matched:boolean;value:string}{
 const q=employerQuestionKey(question).replace(/[?.]+$/,'').trim();
 const label=q.replace(/^(?:what is |please (?:provide|enter) )/,'').replace(/^(?:(?:your|applicant's|candidate's|current|home|residential|contact|primary|mailing) )+/,'');
 const fields:[RegExp,keyof ApplicantProfile][]=[[/^(?:(?:legal |preferred )?(?:full|first|last|given|family) name|name|surname|first and last name|firstname|lastname|fullname)$/,'fullName'],[/^(?:zip(?: code)?|zipcode|postal(?: code)?|postcode|post code)$/,'zipCode'],[/^(?:(?:street |mailing |residential |home |full )?address(?: line 1| 1)?)$/,'address'],[/^(?:city|town|city\s*[/|]\s*town|location\s*\(?\s*city\)?|city\s*[/|]\s*location)$/,'city'],[/^(?:state|province|state\s*[/|]\s*province|state or province)$/,'state'],[/^(?:country|country of residence|country of residency|country where you reside)$/,'country'],[/^(?:location|where are you located|where do you live|where do you reside)$/,'location'],[/^(?:phone|telephone|mobile|cell)(?: phone)?(?: number| no\.?)?$/,'phone']];
 for(const [pattern,key] of fields)if(pattern.test(label)&&entry.phoneCountry!==true){const value=profile?.[key];return {matched:true,value:typeof value==='string'?value.trim():''};}
 if(/^(?:total )?years? (?:of )?(?:work |professional )?experience$/.test(label)){
  const value=profile&&'yearsExperience' in profile?profile.yearsExperience:null;return {matched:true,value:typeof value==='number'&&Number.isFinite(value)&&value>=0?String(value):''};
 }
 if(/\b(?:salary|compensation|remuneration|wage|pay expectation|expected pay|desired pay)\b/.test(q)){
  const salary=profile?.expectedSalary;
  if(/\b(?:current|previous|last|past|minimum|lowest|history|hour\w*|week\w*|daily)\b|£|€|₦|\b(?:GBP|EUR|NGN|CAD|AUD)\b/i.test(q)||!salary)return {matched:true,value:''};
  const period=/\b(?:annual\w*|year\w*|per annum)\b/.test(q)?'year':/\bmonth\w*\b/.test(q)?'month':salary.period;
  if(!['year','month'].includes(period))return {matched:true,value:''};
  const amount=convertUsdSalary(salary,period as 'year'|'month');return {matched:true,value:amount===null?'':`USD ${amount} per ${period}`};
 }
 const countries=[...new Set([...q.matchAll(/\b(united kingdom|great britain|uk|united states(?: of america)?|usa|u\.s\.?a?\.?|canada|(?:republic of )?ireland)\b/g)].map(match=>country(match[0])))];
 if(/\bUS\b/.test(question)&&!countries.includes('usa'))countries.push('usa');
 if(/\b(?:visa|sponsor|right to work|authorized to work|authorised to work|eligible to work)\b/.test(q)){
  if(!countries.length||/\b(?:not|without|and|why|explain|describe|citizen|permanent)\b/.test(q)||countries.length>1&&!/\bor\b/.test(q))return {matched:true,value:''};
  const visa=/\b(?:visa|sponsor)\w*\b/.test(q);if(visa&&!/\b(?:need|requir)\w*\b/.test(q))return {matched:true,value:''};
  const fields:Record<string,string>={uk:'uk',usa:'usa',canada:'canada',ireland:'ireland'};
  const values=countries.map(item=>(profile as Record<string,unknown>|undefined)?.[fields[item]+(visa?'VisaRequired':'RightToWork')]);
  return {matched:true,value:values.some(value=>value===true)?'Yes':values.every(value=>value===false)?'No':''};
 }
 if(/^are you (?:currently )?(?:located|based|living|residing) in\b/.test(q)&&countries.length){
  if(!profile?.country||/\b(?:not|and)\b/.test(q)||countries.length>1&&!/\bor\b/.test(q))return {matched:true,value:''};
  return {matched:true,value:countries.includes(country(profile.country))?'Yes':'No'};
 }
 return {matched:false,value:''};
}
export function applicationAnswerPrefill(application:ApplicationRequest,entry:Record<string,unknown>,choices:Choice,memory:EmployerQuestion[]=[],profile?:AccountProfile):AnswerPrefill{
 const question=String(entry.question||''),key=employerQuestionKey(question),blank:AnswerPrefill={value:'',source:''};
 if(isAutomationCheck(question,choices.options)||authorshipCheck(question)||entry.source==='verification')return blank;
 const fit=(value:unknown,source:AnswerPrefill['source'],keepInvalid=false):AnswerPrefill=>{
  if(typeof value!=='string'||!value.trim()||value.length>20000)return blank;
  const answer=offeredAnswer(value,choices,question,profile);return answer?{value:answer,source}:keepInvalid?{value,source}:blank;
 };
 const confirmed=application.confirmedAnswers?.find(answer=>employerQuestionKey(answer.question)===key);
 if(confirmed)return fit(confirmed.value,'confirmed',true);
 const recorded=(Array.isArray(application.report?.answers)?application.report.answers:[]).filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&employerQuestionKey(String((row as Record<string,unknown>).question||''))===key).at(-1);
 const recordedSource:AnswerPrefill['source']=recorded?.source==='cv'?'cv':recorded?.source==='edit_profile'?'profile':recorded?.source==='saved_profile'?'library':recorded?.source==='cv_and_job'||recorded?.source==='generated'?'suggestion':'recorded';
 // Reference-only applications show what was actually used, never newer profile proposals.
 if(!canEditApplicationQuestions(application))return recorded?fit(recorded.value,recordedSource,true):blank;
 if(manualAnswerOnly(question,choices.options))return blank;
 if(recorded){const answer=fit(recorded.value,recordedSource);if(answer.value)return answer;}
 if(entry.phoneCountry===true){
  const phone=(profile||application.applicantProfile)?.phone||'';if(!/^\+[1-9]\d{7,14}$/.test(phone))return blank;
  const matches=choices.options.map(option=>({option,code:/\+(\d{1,4})\b/.exec(option)?.[1]})).filter(item=>item.code&&phone.startsWith('+'+item.code));
  const longest=Math.max(0,...matches.map(item=>item.code!.length)),candidates=matches.filter(item=>item.code!.length===longest);
  const value=single(candidates.map(item=>item.option));return value?{value,source:'profile'}:blank;
 }
 const authoritative=profileValue(question,entry,profile||application.applicantProfile);
 if(authoritative.matched)return fit(authoritative.value,'profile');
 const cvKey=/^(?:your )?(?:e-?mail(?: address)?)\s*\*?$/i.test(question.trim())?'email':/\blinkedin\b/i.test(question)?'linkedInUrl':/\bgithub\b/i.test(question)?'githubRepositoryUrl':/\b(?:portfolio|personal website)\b/i.test(question)?'portfolioWebsiteUrl':null;
 if(cvKey){const facts=extractCandidateFacts(application.candidate.resumeText),answer=fit(facts[cvKey],'cv');if(answer.value)return answer;}
 const kind=choices.isDropdown?'select':String(entry.field_type||'text');
 const saved=memory.filter(item=>employerQuestionKey(item.question)===key&&answerControlGroup(item.fieldType)===answerControlGroup(kind)&&item.status==='answered'&&item.answer.trim()&&item.reusePolicy!=='manual_only'&&(!item.jobSpecific&&item.reusePolicy!=='job_only'||item.reusePolicy==='exact_question'||item.jobId===application.jobId)&&(!['cv','cv_and_job'].includes(item.source)||!!application.cvSha256&&item.cvSha256===application.cvSha256)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 for(const item of saved){const answer=fit(item.answer,'library');if(answer.value)return answer;}
 // Drafts remain visible proposals requiring the existing explicit review/save action.
 const suggestion=fit(entry.suggested_value,'suggestion');return suggestion.value?suggestion:recorded?fit(recorded.value,recordedSource,true):blank;
}
