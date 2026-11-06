import type {Job} from './cyber-domain';

type SuggestionJob=Pick<Job,'title'|'company'|'industry'>&Partial<Pick<Job,'source'|'disposition'|'saved'>>;
const available=(jobs:SuggestionJob[])=>jobs.filter(j=>j.source?.availability!=='closed'&&!j.saved&&(!j.disposition||j.disposition==='open'));
function uniqueTerms(values:string[]){const seen=new Set<string>();return values.map(s=>s.trim()).filter(s=>{const key=s.toLowerCase();if(!s||s.length>100||seen.has(key))return false;seen.add(key);return true;});}

/** Suggested chips are actual available vacancy titles, bounded to the search input limit. */
export function availableJobTitles(jobs:SuggestionJob[]){return uniqueTerms(available(jobs).map(j=>j.title)).slice(0,12);}

/** Autocomplete uses the available collection only; profile preferences can rank, never add terms. */
export function jobSearchSuggestions(query:string,jobs:SuggestionJob[],preferred:string[]=[]){
 const q=query.trim().toLowerCase(),priority=new Set(preferred.map(s=>s.trim().toLowerCase()));
 const terms=uniqueTerms(available(jobs).flatMap(j=>[j.title,j.company,j.industry||'']));
 return terms.filter(s=>!q||s.toLowerCase().includes(q)).sort((a,b)=>Number(b.toLowerCase().startsWith(q))-Number(a.toLowerCase().startsWith(q))||Number(priority.has(b.toLowerCase()))-Number(priority.has(a.toLowerCase()))).slice(0,10);
}
