import type {Job} from './cyber-domain';

export const suggestedJobTitles=[
 'Application Security Engineer','Product Security Engineer','Web Application Security Tester',
 'Head Of Product Security','Application Security Specialist','Security Engineer','Application Engineer',
 'Network Security Engineer','Application Support Engineer','Cloud Security Engineer',
 'Mobile Application Engineer','Cyber Security Engineer',
] as const;
const relatedRoles=['SOC Analyst','Security Analyst','GRC Analyst','Risk Analyst','Incident Response Analyst','Threat Hunter','Penetration Tester','DevSecOps Engineer','Security Researcher','Red Team Operator'];
/** Local autocomplete terms are suggestions, never fabricated vacancies. */
export function jobSearchSuggestions(query:string,jobs:Pick<Job,'title'|'company'|'industry'>[],preferred:string[]=[]){
 const q=query.trim().toLowerCase(),seen=new Set<string>();
 const terms=[...preferred,...jobs.flatMap(j=>[j.title,j.company,j.industry||'']),...suggestedJobTitles,...relatedRoles].map(s=>s.trim()).filter(s=>{const key=s.toLowerCase();if(!s||s.length>100||seen.has(key))return false;seen.add(key);return true;});
 return terms.filter(s=>!q||s.toLowerCase().includes(q)).sort((a,b)=>Number(b.toLowerCase().startsWith(q))-Number(a.toLowerCase().startsWith(q))).slice(0,10);
}
