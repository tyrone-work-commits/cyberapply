import {bulkApplyCandidates,type Job,type State} from './cyber-domain';
import {jobFit} from './job-browse';

export type BatchJobMatch={job:Job;score:number|null;matched:string[];missing:string[]};
export const CLOSER_CV_MATCH=60;
/** Coverage of supplied skill keywords in the chosen CV, not eligibility or an ATS score. */
export function rankBatchJobs(state:State,jobs:Job[]):BatchJobMatch[]{
 return bulkApplyCandidates(state,jobs).map(job=>({job,...jobFit(job,state.profile.resumeText)})).sort((a,b)=>(b.score??-1)-(a.score??-1)||b.matched.length-a.matched.length);
}
export function closerCvMatch(item:BatchJobMatch){return item.score!==null&&item.score>=CLOSER_CV_MATCH;}
export function validBatchSelection(jobs:BatchJobMatch[],ids:string[],count:5|10){
 return ids.length===count&&new Set(ids).size===count&&ids.every(id=>jobs.some(item=>item.job.id===id));
}
