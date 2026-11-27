import type {ApplicantProfile} from './cyber-domain';

/** Compare answer-bearing information, not capture timestamps or inferred answer history. */
export function preparedProfileKey(profile:ApplicantProfile|undefined){
 if(!profile)return '';
 const {employerQuestions=[],...details}=profile;
 const groups=new Map<string,typeof employerQuestions>();
 for(const row of employerQuestions){
  if(row.source!=='user')continue;
  const key=row.question.replace(/\s+/g,' ').trim().replace(/[\s*]+$/,'').toLowerCase()+'|'+(['select','radio','combobox','checkbox'].includes(row.fieldType)?'choice':['text','textarea'].includes(row.fieldType)?'text':row.fieldType);
  const group=groups.get(key)||[];group.push(row);groups.set(key,group);
 }
 const answers=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
  const latest=rows.reduce((at,row)=>row.updatedAt>at?row.updatedAt:at,'');
  const values=rows.filter(row=>row.updatedAt===latest).map(row=>JSON.stringify({answer:row.answer.trim(),reusePolicy:row.reusePolicy==='manual_only'?'manual_only':'reusable',aiDraft:!!row.aiDraft}));
  return [key,[...new Set(values)].sort()];
 });
 return JSON.stringify({details:Object.fromEntries(Object.entries(details).sort(([a],[b])=>a.localeCompare(b))),answers});
}
