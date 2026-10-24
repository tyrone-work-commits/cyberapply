"use client";
import { useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { verifiedAutoApplyBoards, verifiedAutoApplySearch } from '@/lib/auto-apply-eligibility';
import { boardKey, boardUrl, broadCybersecurityQuery, type DiscoveryReport, type JobSearch } from '@/lib/job-catalog';
import { countdownSeconds } from '@/lib/search-cooldown';

export function JobSources({initial,report,busy,searchReadyAt,onSearch}:{searchReadyAt:number;initial:JobSearch;report?:DiscoveryReport;busy:boolean;onSearch:(settings:JobSearch)=>Promise<void>}){
 const [settings,setSettings]=useState(()=>verifiedAutoApplySearch(initial));
 const [now,setNow]=useState(Date.now);
 const boards=verifiedAutoApplyBoards();
 const seconds=countdownSeconds(searchReadyAt,now);
 const savedKey=JSON.stringify(initial);
 useEffect(()=>{setSettings(verifiedAutoApplySearch(initial));},[savedKey]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>;
  const tick=()=>{const current=Date.now();setNow(current);if(searchReadyAt>current)timer=setTimeout(tick,Math.min(1000,searchReadyAt-current));};
  const wake=()=>{clearTimeout(timer);tick();};
  tick();document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);};
 },[searchReadyAt]);
 const eligibleReport=report?.boards.every(board=>boards.some(approved=>boardKey(approved)===board.key))?report:undefined;
 return <section className="panel job-sources" aria-label="Verified automatic-apply job sources">
  <div className="source-heading"><div><span className="eyebrow">VERIFIED AUTO-APPLY ONLY</span><h2>Employer forms we can support.</h2><p>Explore shows a vacancy only after its exact application form and submission route have been verified. A job-board listing alone does not qualify.</p></div><span className="badge">{boards.length} VERIFIED {boards.length===1?'SOURCE':'SOURCES'}</span></div>
  {!boards.length?<div className="application-status" role="status"><strong>No verified automatic-apply sources yet</strong><p>The existing Greenhouse and Lever feeds can show vacancies, but none currently has a verified automatic-submission route for CyberApply. We will add individual vacancies here only after an authorized form, CV upload and employer confirmation have been tested. Your earlier saved jobs and Apply requests remain in their tabs.</p></div>:<>
   <form onSubmit={event=>{event.preventDefault();if(busy||seconds>0)return;void onSearch(verifiedAutoApplySearch(settings));}}>
    <div className="source-filters"><label>Role keyword <span className="label-hint">Optional</span><input maxLength={100} placeholder="Cybersecurity, SOC, Security Engineer" value={settings.keyword} onChange={event=>setSettings({...settings,keyword:event.target.value})}/></label><label>Location <span className="label-hint">Optional</span><input maxLength={100} placeholder="City, country or region" value={settings.location} onChange={event=>setSettings({...settings,location:event.target.value})}/></label><label className="check-label source-remote"><input type="checkbox" checked={settings.remoteOnly} onChange={event=>setSettings({...settings,remoteOnly:event.target.checked})}/><span>Remote only</span></label><button className="button source-search" type="submit" disabled={busy||seconds>0} aria-describedby={seconds>0?'live-search-wait':undefined}>{busy?<LoaderCircle size={17} className="spin"/>:eligibleReport?<RefreshCw size={17}/>:<Search size={17}/>} {busy?'Checking verified vacancies…':seconds>0?`Search again in ${seconds} ${seconds===1?'second':'seconds'}`:eligibleReport?'Refresh verified jobs':'Find verified jobs'}</button></div>
    {broadCybersecurityQuery(settings.keyword)&&<p className="subtle source-query-help">Cybersecurity includes related security roles, such as SOC Analyst and Security Engineer. Location and remote filters still apply.</p>}
    <details className="source-manager"><summary>{boards.length} verified employer {boards.length===1?'source':'sources'}</summary><div className="source-board-list">{boards.map(board=><div className="source-board" key={boardKey(board)}><div><a href={boardUrl(board)} target="_blank" rel="noopener noreferrer">{board.company}<ExternalLink size={12}/></a><small>{board.provider==='greenhouse'?'Greenhouse':'Lever'} · individually approved vacancies only</small></div></div>)}</div><p className="subtle">Adding a public board URL does not authorize automatic applications. New sources appear after their exact forms pass review.</p></details>
   </form>
   {seconds>0&&<p id="live-search-wait" className="subtle search-wait">Live searches are available once a minute. Your last eligible results remain below.</p>}
   {eligibleReport&&<div className="source-report" aria-live="polite"><strong>Last verified-source search · {new Date(eligibleReport.at).toLocaleString()}</strong><p>{eligibleReport.message}</p><ul>{eligibleReport.boards.map(board=><li key={board.key} className={board.status==='error'?'source-failed':''}><span>{board.company}</span><span>{board.status==='error'?board.message:`${board.matching} matching listings checked`}</span></li>)}</ul></div>}
  </>}
  <p className="subtle source-limits">A paired, running local agent and your reviewed CV are still required to send an application. Only an employer confirmation means Applied.</p>
 </section>;
}
