import { DomainError, emptyState, liveState, type State, type Profile } from './cyber-domain';

export type DeletionScope='application'|'cleared'|'candidate_facts';
export function deletionPlan(before:State,scope:DeletionScope,applicationId?:string,deleteCandidateFacts=false,replacement?:Profile){
 const state=liveState(before),legacy=scope==='candidate_facts'||deleteCandidateFacts;
 const all=[...(state.applications||[]),...(state.applicationArchive?.applications||[])];
 const targets=scope==='application'?all.filter(item=>item.id===applicationId):scope==='cleared'?(state.applicationArchive?.applications||[]):[];
 if(scope==='application'&&!targets.length)throw new DomainError('That application is no longer in your account.',404);
 if(targets.some(item=>item.status==='processing')||(legacy&&state.applications?.some(item=>item.status==='processing')))throw new DomainError('Wait for the application in progress to finish or pause before deleting these records.',409);
 const ids=targets.map(item=>item.id),draftIds=[...new Set([...targets.map(item=>item.draftId),...(scope==='cleared'?state.applicationArchive?.drafts.map(item=>item.id)||[]:[])])];
 if(scope==='cleared'&&!ids.length&&!draftIds.length&&!legacy)throw new DomainError('There are no cleared applications to delete.',409);
 const safety=new Set(state.applicationSafetyJobIds||[]);
 targets.filter(item=>['applied','uncertain'].includes(item.status)).forEach(item=>safety.add(item.jobId));
 if(safety.size)state.applicationSafetyJobIds=[...safety];
 const removedJobs=new Set(targets.map(item=>item.jobId));
 state.applications=(state.applications||[]).filter(item=>!ids.includes(item.id));
 state.drafts=state.drafts.filter(item=>!draftIds.includes(item.id));
 if(state.applicationArchive){
  state.applicationArchive.applications=state.applicationArchive.applications.filter(item=>!ids.includes(item.id));
  state.applicationArchive.drafts=state.applicationArchive.drafts.filter(item=>!draftIds.includes(item.id));
  if(!state.applicationArchive.applications.length&&!state.applicationArchive.drafts.length)delete state.applicationArchive;
 }
 for(const job of state.jobs)if(removedJobs.has(job.id)&&!safety.has(job.id)&&!state.applications.some(item=>item.jobId===job.id)&&job.disposition==='apply_requested')job.disposition='open';
 if(state.lastDecision&&(ids.includes(state.lastDecision.applicationId||'')||draftIds.includes(state.lastDecision.createdDraftId||'')))delete state.lastDecision;
 if(legacy){
  state.legacyCandidateFactsDeleted=true;
  state.profile=replacement?structuredClone(replacement):emptyState().profile;
  state.profile.reviewed=false;
  for(const item of [...state.applications,...(state.applicationArchive?.applications||[])]){
   item.candidate.reviewed=false;delete item.candidate.currentSalary;delete item.candidate.totalExperienceYears;delete item.candidate.cybersecurityExperienceYears;
  }
 }
 return {state,ids,draftIds,legacy};
}

/** Redact product history in SQL without loading every CV-bearing revision into Worker memory. */
export function deletionHistoryExpression(ids:string[],draftIds:string[],legacy:boolean){
 const params:unknown[]=[];
 function filtered(path:string,keys:string[],candidate=false){
  params.push(JSON.stringify(keys));
  const value=candidate&&legacy?"json_remove(json_set(value,'$.candidate.reviewed',json('false')),'$.candidate.currentSalary','$.candidate.totalExperienceYears','$.candidate.cybersecurityExperienceYears')":'value';
  return `json((SELECT COALESCE(json_group_array(json(${value})),'[]') FROM json_each(payload,'${path}') WHERE json_extract(value,'$.id') NOT IN (SELECT value FROM json_each(?))))`;
 }
 const expression=`json_set(payload,'$.applications',${filtered('$.applications',ids,true)},'$.drafts',${filtered('$.drafts',draftIds)},'$.applicationArchive.applications',${filtered('$.applicationArchive.applications',ids,true)},'$.applicationArchive.drafts',${filtered('$.applicationArchive.drafts',draftIds)}${legacy?",'$.profile',json(?), '$.legacyCandidateFactsDeleted',json('true')":''})`;
 if(legacy)params.push(JSON.stringify(emptyState().profile));
 return {expression,params};
}
