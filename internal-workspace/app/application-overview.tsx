"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, CheckCircle2, Clock3, Download, ExternalLink, Eye, FileText, Search, Settings, ShieldCheck, TriangleAlert, Trash2, Undo2 } from 'lucide-react';
import type { ApplicationRequest, Attachment, Draft, Job } from '@/lib/cyber-domain';
import { applicationProgress, type ProgressGroup } from '@/lib/application-progress';
import { ApplicationDeleteDialog, type DeleteTarget } from './application-delete-dialog';
import { ReceiptCheckPanel } from './receipt-check-panel';
import {ApplicationControlsDialog} from './application-controls-dialog';
import {providerNames} from '@/lib/job-catalog';
import type {EmployerQuestion} from '@/lib/employer-questions';
import {applicationFormQuestions} from '@/lib/application-form-questions';
import {ApplicationQuestionAnswers} from './application-question-answers';
import {similarJobs} from '@/lib/job-browse';

function httpsUrl(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function sourceName(job?: Job) {
  if (!job?.source) return 'Listing you added';
  return `${providerNames[job.source.provider]} · ${job.company}`;
}
function timestamp(value:string){return new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}
const filters:[ProgressGroup|'all',string][]=[['all','All applications'],['in_progress','In progress'],['needs_you','Needs you'],['applied','Applied'],['check_outcome','Awaiting confirmation']];

export function ApplicationOverview({settingsOpen,onCloseSettings,applications,jobs,drafts,files,selectedCvId,agentEnabled,lastSeenAt,busy,onRefresh,onRefreshChoices,onCaptureLocations,defaultCity,onChooseCv,onExplore,onQueue,onAnswer,onClear,onRestore,onDelete,legacyDeleted,clearedCount=0,receiptChecksEnabled,onReceiptsChanged,employerQuestions=[]}:{
 settingsOpen:boolean;onCloseSettings:()=>void;
 employerQuestions?:EmployerQuestion[];
 receiptChecksEnabled:boolean;onReceiptsChanged:()=>Promise<void>;
 applications:ApplicationRequest[];jobs:Job[];drafts:Draft[];files:Attachment[];selectedCvId?:string;agentEnabled:boolean;lastSeenAt?:string;busy:boolean;
 onRefresh:(id:string)=>Promise<void>;onRefreshChoices:(id:string)=>Promise<string>;onCaptureLocations:(id:string,cityQuery:string)=>Promise<string>;defaultCity:string;onChooseCv:()=>void;onExplore:()=>void;onQueue:(id:string)=>Promise<void>;onAnswer:(id:string,answers:{question:string;value:string}[])=>Promise<boolean>;
 onClear:()=>Promise<boolean>;onRestore:()=>Promise<void>;clearedCount?:number;
 onDelete:(target:DeleteTarget,legacy:boolean)=>Promise<boolean>;legacyDeleted?:boolean;
}){
 const [filter,setFilter]=useState<ProgressGroup|'all'>('all'),[search,setSearch]=useState('');
 const [confirmClear,setConfirmClear]=useState(false);
 const clearReview=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!confirmClear)return;const trigger=document.activeElement as HTMLElement|null;clearReview.current?.focus({preventScroll:true});clearReview.current?.scrollIntoView({block:'nearest'});return()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[confirmClear]);
 const [deleteTarget,setDeleteTarget]=useState<DeleteTarget|null>(null);
 const chosenCv=files.find(file=>file.id===selectedCvId);
 const ordered=[...applications].sort((a,b)=>b.at.localeCompare(a.at));
 const counts=Object.fromEntries(filters.map(([key])=>[key,key==='all'?ordered.length:ordered.filter(item=>applicationProgress(item).group===key).length]));
 const visible=ordered.filter(item=>{
  const job=jobs.find(job=>job.id===item.jobId);
  return (filter==='all'||applicationProgress(item).group===filter)&&`${job?.title||''} ${job?.company||''} ${sourceName(job)}`.toLowerCase().includes(search.trim().toLowerCase());
 });
 return <section className="application-overview agent-applications" aria-label="Your applications">
  <ApplicationControlsDialog open={settingsOpen} onClose={()=>{setConfirmClear(false);onCloseSettings();}}>
  <div className="agent-tracker-context panel">
   <div className="agent-tracker-identity"><span className="agent-tracker-icon"><Bot size={23}/></span><div><h2 id="application-overview-title">Your application agent</h2><p>{agentEnabled?'Connection enabled · keep the browser runner open on your computer.':'Connect your browser runner to start sending applications.'}</p>{lastSeenAt&&<small>Last request picked up {timestamp(lastSeenAt)}</small>}</div><a className="button quiet" href="/account#application-agent-heading"><Settings size={15}/>{agentEnabled?'Manage agent':'Connect agent'}</a></div>
   <div className="agent-tracker-cv"><FileText size={16}/><span>CV for your next Apply swipe: <strong>{chosenCv?.name||'Choose a CV'}</strong></span><button className="text-link" type="button" onClick={onChooseCv}>{chosenCv?'Change CV':'Choose a CV'}<ArrowRight size={13}/></button></div>
  </div>
  <ReceiptCheckPanel enabled={receiptChecksEnabled} pendingCount={counts.check_outcome} busy={busy} onChanged={onReceiptsChanged}/>
  {(applications.length>0||drafts.length>0)&&<section className="panel application-management" aria-label="Manage applications"><h3>Manage applications</h3>
   <button className="button quiet" type="button" disabled={busy||applications.some(item=>item.status==='processing')} onClick={()=>setConfirmClear(true)}><Trash2 size={16}/>Clear all applications</button>
  {confirmClear&&<div ref={clearReview} tabIndex={-1} className="panel application-reset-confirm" role="group" aria-label="Confirm clearing applications"><h3>Clear your applications list?</h3><p>This clears all {applications.length} application records and {drafts.length} saved drafts, including records hidden by filters. Your CVs, profile, saved jobs and agent connection stay saved. Queued requests will stop. This does not withdraw anything sent to an employer.</p><p>You can restore cleared records here. A previously submitted or uncertain application remains protected against an accidental duplicate.</p><div className="account-actions"><button className="button quiet" type="button" disabled={busy} onClick={()=>setConfirmClear(false)}>Cancel</button><button className="button" type="button" disabled={busy} onClick={()=>void onClear().then(saved=>{if(saved){setConfirmClear(false);setFilter('all');setSearch('');}})}><Trash2 size={16}/>Clear applications</button></div></div>}
  </section>}
  </ApplicationControlsDialog>
  <p className="subtle">New agent runs save a private video here after they finish or pause. Choose Watch recording to replay it.</p>
  {(clearedCount>0||!legacyDeleted)&&<div className="application-reset-controls">
   {clearedCount>0&&<button className="button quiet" type="button" disabled={busy} onClick={()=>void onRestore()}><Undo2 size={16}/>Restore cleared applications ({clearedCount})</button>}
   {clearedCount>0&&<button className="button quiet danger" type="button" disabled={busy} onClick={()=>setDeleteTarget({scope:'cleared',label:`${clearedCount} cleared application records and their saved drafts`})}><Trash2 size={16}/>Permanently delete cleared applications</button>}
   {!legacyDeleted&&<button className="button quiet" type="button" disabled={busy} onClick={()=>setDeleteTarget({scope:'candidate_facts',label:'Old Candidate Facts and manual review data; uploaded CV files and CV review scores are kept.'})}><Trash2 size={16}/>Delete old Candidate Facts data</button>}
  </div>}
  <div className="application-filters" role="group" aria-label="Filter applications by status">{filters.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} className={filter===key?'application-filter active':'application-filter'} onClick={()=>setFilter(key)}><span>{label}</span><strong>{counts[key]}</strong></button>)}</div>
  <div className="application-list-heading"><div><h2>Your applications</h2><p role="status">{visible.length} {visible.length===1?'application':'applications'}{filter==='all'?'':` · ${filters.find(([key])=>key===filter)?.[1]}`}</p></div><label className="application-search"><Search size={16}/><span className="sr-only">Find an application by role, company or source</span><input type="search" placeholder="Find a role or company" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
  {visible.length?<ol className="application-overview-list">{visible.map(application=>{
   const job=jobs.find(item=>item.id===application.jobId),progress=applicationProgress(application),attachedFile=files.find(file=>file.id===application.cv?.fileId),draft=drafts.find(item=>item.id===application.draftId);
   const sourceUrl=httpsUrl(application.sourceUrl),applyUrl=httpsUrl(job?.applyUrl)||sourceUrl;
   const needsUpdate=['materials_changed','cv_required','candidate_review_required'].includes(application.reason)||!attachedFile;
   const canUpdate=!!chosenCv&&['needs_action','queued','needs_attention','failed'].includes(application.status)&&needsUpdate;
   const canChangeCv=!!chosenCv&&!!attachedFile&&application.cv?.fileId!==chosenCv.id&&['needs_action','needs_attention','failed'].includes(application.status);
   const answeringQuestions=application.status==='needs_attention'&&Array.isArray(application.report?.unresolved)&&application.report.unresolved.some(item=>!item||typeof item!=='object'||(item as Record<string,unknown>).source!=='edit_profile');
   const confirmation=application.result?.evidence,confirmationUrl=httpsUrl(confirmation?.url);
   return <li className={`panel application-overview-card application-tone-${progress.tone}`} key={application.id}>
    <div className="application-overview-main"><div className="application-employer"><span className="application-company-mark" aria-hidden="true">{(job?.company||'?').slice(0,1).toUpperCase()}</span><div><h3>{job?.title||'Job listing unavailable'}</h3><p>{job?.company||'Employer not available'}{job?.location?` · ${job.location}`:''}</p></div></div><span className={`application-status-badge ${progress.tone}`}>{progress.group==='applied'?<CheckCircle2 size={14}/>:progress.group==='needs_you'?<TriangleAlert size={14}/>:<Clock3 size={14}/>} {progress.label}</span></div>
    <ol className="application-journey" aria-label="Application progress">{progress.steps.map((step,index)=><li key={step.label} className={step.state} aria-current={step.state==='current'?'step':undefined}><span aria-hidden="true">{step.state==='done'?<Check size={12}/>:index+1}</span>{step.label}</li>)}</ol>
    <div className="application-next-step"><strong>{progress.group==='applied'?'Employer confirmation recorded':progress.group==='check_outcome'?'Awaiting employer confirmation':progress.group==='needs_you'?'Your next step':'What happens next'}</strong><p>{progress.description}</p>{application.result?.message&&<p className="application-agent-message">{application.receiptVerification?'Latest outcome update':'Agent’s last update'}: {application.result.message}</p>}</div>
    {!!progress.actionEvidence.length&&<section className="application-detail-section" aria-label="Recorded agent actions"><h4>Recorded agent actions</h4><ul>{progress.actionEvidence.map(text=><li key={text}>{text}</li>)}</ul></section>}
    <dl className="application-request-facts"><div><dt>CV for this application</dt><dd>{application.cv?.name||'No CV attached'}{application.cv&&!attachedFile&&<small>Original file unavailable</small>}</dd></div><div><dt>Vacancy source</dt><dd>{sourceName(job)}{sourceUrl&&<a href={sourceUrl} target="_blank" rel="noopener noreferrer">View vacancy<ExternalLink size={12}/></a>}</dd></div><div><dt>Requested</dt><dd>{timestamp(application.at)}</dd></div></dl>
    {progress.group==='applied'&&<div className="application-confirmation"><ShieldCheck size={19}/><div><strong>{application.receiptVerification?'Employer email verified':'Confirmation saved'}</strong><p>{application.result?.receipt||confirmation?.text}</p>{confirmationUrl&&<a href={confirmationUrl} target="_blank" rel="noopener noreferrer">{application.receiptVerification?'Open employer receipt in Gmail':'Open confirmation page'}<ExternalLink size={12}/></a>}<small>{application.receiptVerification?`Matched the role, employer, recipient, date and authenticated sender. Received ${timestamp(application.receiptVerification.receivedAt)}.`:'The browser agent recorded this evidence. Check your email for any employer follow-up.'}</small></div></div>}
    {!!applicationFormQuestions(application,employerQuestions).length&&<ApplicationQuestionAnswers key={`${application.id}-${application.result?.at||''}`} application={application} employerQuestions={employerQuestions} busy={busy} onRefreshChoices={()=>onRefreshChoices(application.id)} onCaptureLocations={cityQuery=>onCaptureLocations(application.id,cityQuery)} defaultCity={defaultCity} onSave={answers=>onAnswer(application.id,answers)}/>}
    {!!application.confirmedAnswers?.length&&<details className="application-saved-draft"><summary>Review your saved answers ({application.confirmedAnswers.length})</summary><dl>{application.confirmedAnswers.map((answer,index)=><div className="application-detail-section" key={`${answer.question}-${index}`}><dt><strong>{answer.question}</strong></dt><dd style={{margin:0,whiteSpace:'pre-wrap'}}>{answer.value}</dd></div>)}</dl></details>}
    <div className="application-overview-actions">
     {application.agentVersion===2&&<><a id={'watch-live-'+application.id} className="button quiet" href={'/application-watch?request='+encodeURIComponent(application.id)} target="_blank" rel="noopener noreferrer" title="Watch live (opens in a new tab)"><Eye size={15}/>Watch live<ExternalLink size={13}/><span className="sr-only"> (opens in a new tab)</span></a><a id={'watch-recording-'+application.id} className="button quiet" href={'/application-watch?request='+encodeURIComponent(application.id)+'&mode=recording'} target="_blank" rel="noopener noreferrer" title="Watch recording (opens in a new tab)"><Eye size={15}/>Watch recording<ExternalLink size={13}/><span className="sr-only"> (opens in a new tab)</span></a></>}
     {progress.canQueue&&!!attachedFile&&!needsUpdate&&!answeringQuestions&&(agentEnabled?<button type="button" className="button" disabled={busy} onClick={()=>void onQueue(application.id)}><Bot size={15}/>{application.confirmedAnswers?.length?'Continue with my answers':'Start agent for this job'}</button>:<a className="button" href="/account#application-agent-heading"><Bot size={15}/>Connect agent to apply</a>)}
     {canUpdate&&<button type="button" className="button" disabled={busy} onClick={()=>void onRefresh(application.id)}><FileText size={15}/>{application.cv?'Update request with chosen CV':'Attach chosen CV'}</button>}
     {!attachedFile&&!chosenCv&&progress.group==='needs_you'&&<button type="button" className="button" onClick={onChooseCv}><FileText size={15}/>Choose a CV</button>}
     {progress.group==='check_outcome'&&applyUrl&&<a className="button quiet" href={applyUrl} target="_blank" rel="noopener noreferrer">Check employer website<ExternalLink size={15}/></a>}
     {attachedFile&&<a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}?view=1`} target="_blank" rel="noopener noreferrer"><Eye size={15}/>View application CV</a>}
     <button className="button quiet danger" type="button" disabled={busy||application.status==='processing'} onClick={()=>setDeleteTarget({scope:'application',applicationId:application.id,label:`${job?.title||'Application'}${job?.company?` · ${job.company}`:''}`})}><Trash2 size={15}/>Delete application</button>
    </div>
    <details className="application-detail-panel"><summary>Application details and agent report</summary>
     {application.report?<AgentReport value={application.report}/>:<p className="subtle">The agent’s answers, experience calculation, company research and cover letter will appear here after it reports back.</p>}
     {job&&<div className="application-detail-section"><h4>Jobs you might like</h4>{similarJobs(job,jobs).slice(0,3).map(other=><p key={other.id}><a className="text-link" href={'/workspace?view=search&job='+encodeURIComponent(other.id)}>{other.title} · {other.company}</a></p>)}{!similarJobs(job,jobs).length&&<p className="subtle">No similar roles in your collection yet.</p>}</div>}
     <div className="application-detail-section"><h4>Recorded activity</h4><ol className="application-event-list">{progress.events.map((event,index)=><li key={`${event.label}-${index}`}><span>{event.label}</span><time dateTime={event.at}>{timestamp(event.at)}</time></li>)}</ol></div>
     <div className="application-detail-section"><h4>Files and source</h4><div className="application-overview-actions">{attachedFile&&<a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}`} download><Download size={15}/>Download application CV</a>}{applyUrl&&<a className="button quiet" href={applyUrl} target="_blank" rel="noopener noreferrer">Open employer application<ExternalLink size={15}/></a>}{canChangeCv&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void onRefresh(application.id)}>Use {chosenCv!.name} instead</button>}</div></div>
     <a className="button quiet" href={`/workspace?view=cover-letters&job=${encodeURIComponent(application.jobId)}`}>Generate cover letter</a>{application.coverLetter&&<p className="subtle">Reviewed cover letter attached · version {application.coverLetter.version}</p>}{draft&&<details className="application-saved-draft"><summary>Earlier saved draft for manual use</summary><p className="subtle">This is your saved draft. The agent prepares its own cover letter, shown in its report above.</p><pre className="snapshot-text">{draft.text}</pre></details>}
    </details>
   </li>;
  })}</ol>:<div className="panel application-overview-empty"><span className="agent-tracker-icon"><FileText size={25}/></span><h3>{ordered.length?'No applications in this view':'Your next application starts in Explore'}</h3><p>{ordered.length?'Try another status or search for a different role or company.':'Swipe Apply on a role. With your CV and agent connected, its progress will appear here.'}</p>{ordered.length?<button className="button quiet" type="button" onClick={()=>{setFilter('all');setSearch('');}}>Show all applications</button>:<button className="button" type="button" onClick={onExplore}>Explore jobs<ArrowRight size={15}/></button>}</div>}
 {deleteTarget&&<ApplicationDeleteDialog target={deleteTarget} busy={busy} onCancel={()=>setDeleteTarget(null)} onDelete={onDelete}/>}
 </section>;
}


function AgentReport({value}:{value:unknown}){
 if(!value||typeof value!=='object')return null;
 const report=value as Record<string,unknown>;
 const answers=Array.isArray(report.answers)?report.answers.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 const unresolved=Array.isArray(report.unresolved)?report.unresolved.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 const experience=report.experience&&typeof report.experience==='object'?report.experience as Record<string,unknown>:null;
 const research=report.research&&typeof report.research==='object'?report.research as Record<string,unknown>:null;
 const findings=Array.isArray(research?.company_findings)?research.company_findings.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 const sources=Array.isArray(research?.sources)?research.sources.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 const memory=(report.questionDelivery||report.answerMemory) as {omitted?:number;deliveryFailed?:number}|undefined;
 const sourceLabels:Record<string,string>={cv:'From your CV',saved_profile:'Saved employer answer in Account Profile',cv_and_job:'Automatically generated from your CV and the role',salary_research:'Earlier salary research',edit_profile:'From Edit Profile',user_confirmed:'Your confirmed answer'};
 return <div className="application-agent-report">
  {(Number(memory?.omitted)>0||Number(memory?.deliveryFailed)>0)&&<p role="status">Some employer questions could not be saved to Answers library. {Number(memory?.omitted)>0?"Your workspace is near its storage limit; earlier saved answers were kept.":"Question delivery could not be confirmed."} The employer application outcome is unchanged.</p>}
  {experience&&<section className="application-detail-section"><h4>Cybersecurity experience</h4><p>{experience.established?`${experience.years} years${experience.approximate?' (estimated from the dates in your CV)':''}`:'Duration could not be established from dated work history'}.</p><p className="subtle">{String(experience.note||'')}</p>{Array.isArray(experience.evidence)&&<ul>{experience.evidence.map((item,index)=><li key={index}>{String(item)}</li>)}</ul>}</section>}
  {!!findings.length&&<section className="application-detail-section"><h4>Company research and possible contribution</h4><ul>{findings.map((finding,index)=><li key={index}>{String(finding.text||'')}{typeof finding.source_url==='string'&&httpsUrl(finding.source_url)&&<> <a href={httpsUrl(finding.source_url)!} target="_blank" rel="noopener noreferrer">Read source<ExternalLink size={12}/></a></>}</li>)}</ul></section>}
  {typeof report.cover_letter==='string'&&!!report.cover_letter&&<section className="application-detail-section"><h4>Cover letter prepared for this job</h4><pre className="snapshot-text">{report.cover_letter}</pre></section>}
  {!!answers.length&&<section className="application-detail-section"><h4>Prepared answers</h4><ol className="application-answer-evidence">{answers.map((answer,index)=><li key={index}><strong>{String(answer.question||answer.label||`Prepared answer ${index+1}`)}</strong><p>{String(answer.value??'')}</p><small>{sourceLabels[String(answer.source)]||'Agent preparation'}</small>{typeof answer.evidence==='string'&&<details><summary>Supporting evidence</summary><p className="subtle">{answer.evidence}</p></details>}</li>)}</ol>{answers.some(answer=>answer.source==='salary_research')&&<p className="subtle">Salary answers are proposed expectations based on the recorded range, currency and pay period.</p>}</section>}
  {!!sources.length&&<section className="application-detail-section"><h4>Research sources</h4><ul>{sources.map((source,index)=>typeof source.url==='string'&&httpsUrl(source.url)?<li key={index}><a href={httpsUrl(source.url)!} target="_blank" rel="noopener noreferrer">{new URL(source.url).hostname}<ExternalLink size={12}/></a>{typeof source.accessed_at==='string'&&<small>Read {source.accessed_at}</small>}</li>:null)}</ul></section>}
  {!!unresolved.length&&<section className="application-detail-section"><h4>Questions the agent could not answer</h4><ul>{unresolved.map((item,index)=><li key={index}><strong>{String(item.question||'Form question')}</strong><p className="subtle">{String(item.reason||'Please review this answer.')}</p></li>)}</ul></section>}
 </div>;
}
