"use client";
import { useEffect, useState } from 'react';
import { Search, RefreshCw, LoaderCircle } from 'lucide-react';
import JobBrowseFilters from './job-browse-filters';
import JobSearchReport from './job-search-report';
import { countdownSeconds } from '@/lib/search-cooldown';
import { defaultSearch, broadCybersecurityQuery, type JobSearch, type DiscoveryReport } from '@/lib/job-catalog';

export function JobSources({initial,report,busy,searchReadyAt,onSearch,onFilter,suggestedRoles=[],resultCount,sourceLoading=false}:{searchReadyAt:number;initial:JobSearch;report?:DiscoveryReport;busy:boolean;onSearch:(settings:JobSearch)=>Promise<void>;onFilter:(settings:JobSearch)=>void;suggestedRoles?:string[];resultCount:number;sourceLoading?:boolean}){
 const [settings,setSettings]=useState({...defaultSearch,...initial});
 const [now,setNow]=useState(Date.now);
 const seconds=countdownSeconds(searchReadyAt,now);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>;
  const tick=()=>{const current=Date.now();setNow(current);if(searchReadyAt>current)timer=setTimeout(tick,Math.min(1000,searchReadyAt-current));};
  const wake=()=>{clearTimeout(timer);tick();};
  tick();document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);};
 },[searchReadyAt]);
 const savedKey=JSON.stringify(initial);
 useEffect(()=>{setSettings({...defaultSearch,...initial});},[savedKey]);
 function updateSettings(next:JobSearch){setSettings(next);onFilter(next);}
 return <section className="panel job-sources" aria-label="Live job sources"><div className="source-heading"><div><span className="eyebrow">6 SUPPORTED SOURCE TYPES</span><h2>Find live employer vacancies.</h2><p>Search selected company boards for cybersecurity roles. Remote roles may still have country or work-authorization restrictions.</p></div><span className="badge">REAL LISTINGS</span></div><form onSubmit={event=>{event.preventDefault();if(busy||sourceLoading||seconds>0||!settings.boards.length)return;void onSearch(settings);}}><div className="source-filters"><label>Role keyword <span className="label-hint">Optional</span><input maxLength={100} list="career-role-suggestions" placeholder="Cybersecurity, SOC, Security Engineer" value={settings.keyword} onChange={event=>updateSettings({...settings,keyword:event.target.value})}/></label><label>Location <span className="label-hint">Optional</span><input maxLength={100} placeholder="City, country or region" value={settings.location} onChange={event=>updateSettings({...settings,location:event.target.value})}/></label><label className="check-label source-remote"><input type="checkbox" checked={settings.remoteOnly} onChange={event=>updateSettings({...settings,remoteOnly:event.target.checked})}/><span>Remote only</span></label><button className="button source-search" type="submit" disabled={busy||sourceLoading||seconds>0||!settings.boards.length} aria-describedby={seconds>0?'live-search-wait':undefined}>{busy?<LoaderCircle size={17} className="spin"/>:report?<RefreshCw size={17}/>:<Search size={17}/>} {sourceLoading?'Loading saved sources…':busy?'Searching employer boards…':seconds>0?`Search again in ${seconds} ${seconds===1?'second':'seconds'}`:report?'Refresh live jobs':'Find live jobs'}</button></div><p className="subtle search-result-count" role="status">{resultCount} matching {resultCount===1?'vacancy':'vacancies'} · results update immediately.</p>{broadCybersecurityQuery(settings.keyword)&&<p className="subtle source-query-help">Cybersecurity includes related security roles, such as SOC Analyst and Security Engineer. Your location and remote filters still apply.</p>}<p className="subtle">{sourceLoading?'Loading employer boards…':`${settings.boards.length} employer boards selected in your profile.`} <a href="/onboarding?edit=1#job-source-settings">Manage sources in Account Profile</a></p>{!sourceLoading&&!settings.boards.length&&<p className="info-strip">Choose an employer board in your profile to enable live searches.</p>}<datalist id="career-role-suggestions">{suggestedRoles.map(role=><option key={role} value={role}/>)}</datalist><JobBrowseFilters beforeSave={<JobSearchReport report={report}/>} settings={settings} onChange={updateSettings} onApply={onFilter} busy={busy}/></form>{seconds>0&&<p id="live-search-wait" className="subtle search-wait">Live searches are available once a minute. Your last results are still available below.</p>}<p className="subtle source-limits">Up to 24 new roles per search. Existing choices and drafts are preserved. No profile or CV is sent when searching. Applying automatically needs a separate authorized employer connection.</p></section>;
}
