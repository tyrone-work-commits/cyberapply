"use client";
import {ApplicationSessionRecovery,useApplicationSessionRecovery} from './application-session-recovery';
import {ApplicationBrowserButton} from './application-browser-button';
import {ApplicationManualSubmit} from './application-manual-submit';
import {manualDisplaySession,type ManualBrowserHealth} from '@/lib/manual-submission';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, CheckCircle2, Clock3, Download, ExternalLink, Eye, FileText, Search, Settings, ShieldCheck, TriangleAlert, Trash2, Undo2 } from 'lucide-react';
import type { AccountProfile, ApplicationRequest, Attachment, Draft, Job } from '@/lib/cyber-domain';
import { applicationProgress, type ProgressGroup } from '@/lib/application-progress';
import { ApplicationDeleteDialog, type DeleteTarget } from './application-delete-dialog';
import {ApplicationControlsDialog} from './application-controls-dialog';
import {providerNames} from '@/lib/job-catalog';
import type {EmployerQuestion} from '@/lib/employer-questions';
import {applicationFormQuestions,applicationAnswerStage} from '@/lib/application-form-questions';
import {ApplicationQuestionAnswers} from './application-question-answers';
import {similarJobs} from '@/lib/job-browse';
import {applicationEmployerLink} from '@/lib/application-employer-link';
import {currentHandoff,isHumanAgentQuestion} from '@/lib/verification-handoff';
import {ApplicationVerificationHandoff} from './application-verification-handoff';
import './application-video-actions.css';
import './application-bulk-delete.css';
import {MAX_APPLICATION_DELETE_SELECTION} from '@/lib/application-deletion';

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

export function ApplicationOverview({settingsOpen,onCloseSettings,applications,jobs,drafts,files,selectedCvId,agentEnabled,lastSeenAt,busy,onRefresh,onRefreshChoices,onChooseCv,onExplore,onQueue,onAnswer,onClear,onRestore,onDelete,legacyDeleted,clearedCount=0,employerQuestions=[],accountProfile}:{
 settingsOpen:boolean;onCloseSettings:()=>void;
 employerQuestions?:EmployerQuestion[];
 accountProfile?:AccountProfile;
 applications:ApplicationRequest[];jobs:Job[];drafts:Draft[];files:Attachment[];selectedCvId?:string;agentEnabled:boolean;lastSeenAt?:string;busy:boolean;
 onRefresh:(id:string)=>Promise<void>;onRefreshChoices:(id:string)=>Promise<string>;onChooseCv:()=>void;onExplore:()=>void;onQueue:(id:string)=>Promise<void>;onAnswer:(id:string,answers:{question:string;value:string}[])=>Promise<boolean>;
 onClear:()=>Promise<boolean>;onRestore:()=>Promise<void>;clearedCount?:number;
 onDelete:(target:DeleteTarget,legacy:boolean)=>Promise<boolean>;legacyDeleted?:boolean;
}){
 const sessionRecovery=useApplicationSessionRecovery(applications);
 const sessionLocked=sessionRecovery.blocked;
 const [filter,setFilter]=useState<ProgressGroup|'all'>('all'),[search,setSearch]=useState('');
 const [confirmClear,setConfirmClear]=useState(false);
 const [manualHealth,setManualHealth]=useState<Record<string,ManualBrowserHealth>>({});
 const reportHealth=(id:string,next:ManualBrowserHealth)=>setManualHealth(previous=>{const old=previous[id];return old&&old.state===next.state&&old.open===next.open&&old.canRestore===next.canRestore&&old.canConfirmUnsent===next.canConfirmUnsent&&old.legacy===next.legacy?previous:{...previous,[id]:next};});
 const clearReview=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!confirmClear)return;const trigger=document.activeElement as HTMLElement|null;clearReview.current?.focus({preventScroll:true});clearReview.current?.scrollIntoView({block:'nearest'});return()=>{if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[confirmClear]);
 const [selecting,setSelecting]=useState(false),[selectedIds,setSelectedIds]=useState<string[]>([]);
 useEffect(()=>{setSelectedIds(previous=>{const next=previous.filter(id=>applications.some(item=>item.id===id&&item.status!=='processing'));return next.length===previous.length?previous:next;});},[applications]);
 const selected=applications.filter(item=>item.status!=='processing'&&selectedIds.includes(item.id));
 const applicationLabel=(application:ApplicationRequest)=>{const job=jobs.find(item=>item.id===application.jobId);return `${job?.title||'Application'}${job?.company?` · ${job.company}`:''}`;};
 const closeDelete=()=>setDeleteTarget(null);
 const deleteRecords=async(target:DeleteTarget,legacy:boolean)=>{if(sessionLocked)return false;const saved=await onDelete(target,legacy);if(saved&&target.scope==='selected'){setSelectedIds([]);setSelecting(false);}return saved;};
 const [deleteTarget,setDeleteTarget]=useState<DeleteTarget|null>(null);
 const chosenCv=files.find(file=>file.id===selectedCvId);
 const ordered=[...applications].sort((a,b)=>b.at.localeCompare(a.at));
 const counts=Object.fromEntries(filters.map(([key])=>[key,key==='all'?ordered.length:ordered.filter(item=>applicationProgress(item).group===key).length]));
 const visible=ordered.filter(item=>{
  const job=jobs.find(job=>job.id===item.jobId);
  return (filter==='all'||applicationProgress(item).group===filter)&&`${job?.title||''} ${job?.company||''} ${sourceName(job)}`.toLowerCase().includes(search.trim().toLowerCase());
 });
 const selectableVisible=visible.filter(item=>item.status!=='processing');
 const allShownSelected=selectableVisible.length>0&&selectableVisible.every(item=>selectedIds.includes(item.id));
 const hiddenSelected=selected.filter(item=>!visible.some(shown=>shown.id===item.id)).length;
 return <section className="application-overview agent-applications" aria-label="Your applications">
  <ApplicationControlsDialog open={settingsOpen} onClose={()=>{setConfirmClear(false);onCloseSettings();}}>
  <div className="agent-tracker-context panel">
   <div className="agent-tracker-identity"><span className="agent-tracker-icon"><Bot size={23}/></span><div><h2 id="application-overview-title">Your application agent</h2><p>{agentEnabled?'Connection enabled · keep the browser runner open on your computer.':'Connect your browser runner to start sending applications.'}</p>{lastSeenAt&&<small>Last request picked up {timestamp(lastSeenAt)}</small>}</div><a className="button quiet" href="/account#application-agent-heading"><Settings size={15}/>{agentEnabled?'Manage agent':'Connect agent'}</a></div>
   <div className="agent-tracker-cv"><FileText size={16}/><span>CV for your next Apply swipe: <strong>{chosenCv?.name||'Choose a CV'}</strong></span><button className="text-link" type="button" onClick={onChooseCv}>{chosenCv?'Change CV':'Choose a CV'}<ArrowRight size={13}/></button></div>
  </div>
  {(applications.length>0||drafts.length>0)&&<section className="panel application-management" aria-label="Manage applications"><h3>Manage applications</h3>
   <button className="button quiet" type="button" disabled={busy||sessionLocked||applications.some(item=>item.status==='processing')} onClick={()=>setConfirmClear(true)}><Trash2 size={16}/>Clear all applications</button>
  {confirmClear&&<div ref={clearReview} tabIndex={-1} className="panel application-reset-confirm" role="group" aria-label="Confirm clearing applications"><h3>Clear your applications list?</h3><p>This clears all {applications.length} application records and {drafts.length} saved drafts, including records hidden by filters. Your CVs, profile, saved jobs and agent connection stay saved. Queued requests will stop. This does not withdraw anything sent to an employer.</p><p>You can restore cleared records here. A previously submitted or uncertain application remains protected against an accidental duplicate.</p><div className="account-actions"><button className="button quiet" type="button" disabled={busy} onClick={()=>setConfirmClear(false)}>Cancel</button><button className="button" type="button" disabled={busy||sessionLocked} onClick={()=>void onClear().then(saved=>{if(saved){setConfirmClear(false);setFilter('all');setSearch('');}})}><Trash2 size={16}/>Clear applications</button></div></div>}
  </section>}
  </ApplicationControlsDialog>
  <p className="subtle">Open the original employer application page in a new tab from any card. This is separate from the agent’s filled browser session. Watch live shows the agent’s current browser and offers a same-session handoff when your input is needed. Watch recording shows one continuous video of the agent’s work so far and extends automatically when it continues, including after you save employer answers.</p>
  {(clearedCount>0||!legacyDeleted)&&<div className="application-reset-controls">
   {clearedCount>0&&<button className="button quiet" type="button" disabled={busy||sessionLocked} onClick={()=>void onRestore()}><Undo2 size={16}/>Restore cleared applications ({clearedCount})</button>}
   {clearedCount>0&&<button className="button quiet danger" type="button" disabled={busy||sessionLocked} onClick={()=>setDeleteTarget({scope:'cleared',label:`${clearedCount} cleared application records and their saved drafts`})}><Trash2 size={16}/>Permanently delete cleared applications</button>}
   {!legacyDeleted&&<button className="button quiet" type="button" disabled={busy||sessionLocked} onClick={()=>setDeleteTarget({scope:'candidate_facts',label:'Old Candidate Facts and manual review data; uploaded CV files and CV review scores are kept.'})}><Trash2 size={16}/>Delete old Candidate Facts data</button>}
  </div>}
  <div className="application-filters" role="group" aria-label="Filter applications by status">{filters.map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} className={filter===key?'application-filter active':'application-filter'} onClick={()=>setFilter(key)}><span>{label}</span><strong>{counts[key]}</strong></button>)}</div>
  <div className="application-list-heading"><div><h2>Your applications</h2><p role="status">{visible.length} {visible.length===1?'application':'applications'}{filter==='all'?'':` · ${filters.find(([key])=>key===filter)?.[1]}`}</p></div><label className="application-search"><Search size={16}/><span className="sr-only">Find an application by role, company or source</span><input type="search" placeholder="Find a role or company" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
  {!!applications.length&&<section className="application-bulk-controls" aria-label="Select applications to delete">
   {!selecting?<button className="button quiet" type="button" disabled={busy||sessionLocked||!applications.some(item=>item.status!=='processing')} onClick={()=>setSelecting(true)}><Trash2 size={16}/>Select applications</button>:<>
    <label className="application-bulk-check"><input type="checkbox" disabled={busy||sessionLocked||!selectableVisible.length} checked={allShownSelected} ref={element=>{if(element)element.indeterminate=!allShownSelected&&selectableVisible.some(item=>selectedIds.includes(item.id));}} onChange={event=>setSelectedIds(previous=>event.target.checked?[...new Set([...previous,...selectableVisible.map(item=>item.id)])].slice(0,MAX_APPLICATION_DELETE_SELECTION):previous.filter(id=>!selectableVisible.some(item=>item.id===id)))}/><span>Select all shown</span></label>
    <p role="status">{selected.length} selected{hiddenSelected?` · ${hiddenSelected} hidden by filters`:''}</p>
    <button className="button quiet danger" type="button" disabled={busy||sessionLocked||!selected.length} onClick={()=>setDeleteTarget({scope:'selected',applicationIds:selected.map(item=>item.id),labels:selected.map(applicationLabel),label:`${selected.length} selected application${selected.length===1?'':'s'}`})}><Trash2 size={16}/>Delete selected ({selected.length})</button>
    <button className="button quiet" type="button" disabled={busy} onClick={()=>{setSelecting(false);setSelectedIds([]);}}>Cancel selection</button>
    <p className="application-bulk-note">Select up to {MAX_APPLICATION_DELETE_SELECTION} applications. Applications the agent is processing cannot be selected. Deleting here does not withdraw an employer application.</p>
   </>}
   <ApplicationSessionRecovery recovery={sessionRecovery}/>
  </section>}
  <div className={sessionLocked?'application-cards-locked':undefined} inert={sessionLocked||undefined} aria-hidden={sessionLocked||undefined}>
  {visible.length?<ol className="application-overview-list">{visible.map(application=>{
   const job=jobs.find(item=>item.id===application.jobId),progress=applicationProgress(application,Date.now(),manualDisplaySession(application)?manualHealth[application.id]||{state:'checking',open:'idle',canRestore:false}:undefined),attachedFile=files.find(file=>file.id===application.cv?.fileId),draft=drafts.find(item=>item.id===application.draftId),verificationNeeded=!application.manualSubmission&&applicationAnswerStage(application,employerQuestions)==='verification';
   const liveHandoff=currentHandoff(application),handoffInQuestions=applicationFormQuestions(application,employerQuestions).some(item=>isHumanAgentQuestion(String((item as Record<string,unknown>).question||'')));
   const prepareVerification=verificationNeeded&&application.status==='needs_attention'&&!liveHandoff;
   const sourceUrl=httpsUrl(application.sourceUrl),applyUrl=applicationEmployerLink(application,job);
   const needsUpdate=['materials_changed','cv_required','candidate_review_required'].includes(application.reason)||!attachedFile;
   const canUpdate=!!chosenCv&&['needs_action','queued','needs_attention','failed'].includes(application.status)&&needsUpdate;
   const canChangeCv=!!chosenCv&&!!attachedFile&&application.cv?.fileId!==chosenCv.id&&['needs_action','needs_attention','failed'].includes(application.status);
   const answeringQuestions=application.status==='needs_attention'&&Array.isArray(application.report?.unresolved)&&application.report.unresolved.some(item=>!item||typeof item!=='object'||(item as Record<string,unknown>).source!=='edit_profile');
   const confirmation=application.result?.evidence,confirmationUrl=application.receiptVerification?null:httpsUrl(confirmation?.url);
   return <li className={`panel application-overview-card application-tone-${progress.tone}`} key={application.id}>
    {selecting&&<label className="application-bulk-check application-card-selection"><input type="checkbox" aria-label={`Select ${applicationLabel(application)} for deletion`} checked={selectedIds.includes(application.id)&&application.status!=='processing'} disabled={busy||application.status==='processing'||(selected.length>=MAX_APPLICATION_DELETE_SELECTION&&!selectedIds.includes(application.id))} onChange={event=>setSelectedIds(previous=>event.target.checked?[...new Set([...previous,application.id])].slice(0,MAX_APPLICATION_DELETE_SELECTION):previous.filter(id=>id!==application.id))}/><span>{application.status==='processing'?'Agent working — selection unavailable':'Select application'}</span></label>}
    <div className="application-overview-main"><div className="application-employer"><span className="application-company-mark" aria-hidden="true">{(job?.company||'?').slice(0,1).toUpperCase()}</span><div><h3>{job?.title||'Job listing unavailable'}</h3><p>{job?.company||'Employer not available'}{job?.location?` · ${job.location}`:''}</p></div></div><span className={`application-status-badge ${progress.tone}`}>{progress.group==='applied'?<CheckCircle2 size={14}/>:progress.group==='needs_you'?<TriangleAlert size={14}/>:<Clock3 size={14}/>} {progress.label}</span></div>
    <ol className="application-journey" aria-label="Application progress">{progress.steps.map((step,index)=><li key={step.label} className={step.state} aria-current={step.state==='current'?'step':undefined}><span aria-hidden="true">{step.state==='done'?<Check size={12}/>:index+1}</span>{step.label}</li>)}</ol>
    <div className="application-next-step"><strong>{verificationNeeded?'Employer verification needed':progress.group==='applied'?'Employer confirmation recorded':progress.group==='check_outcome'?'Awaiting employer confirmation':progress.group==='needs_you'?'Your next step':'What happens next'}</strong><p>{liveHandoff?.kind==='question'?progress.description:verificationNeeded?'Your saved answers are retained. Complete the employer’s human or security verification on its original website. Saving the same answers again cannot complete that check.':progress.description}</p>{application.result?.message&&progress.label!=='Browser session disconnected'&&<p className="application-agent-message">{application.receiptVerification?'Latest outcome update':'Agent’s last update'}: {application.receiptVerification?'Employer confirmation was verified and saved.':application.result.message}</p>}</div>
    {!!progress.actionEvidence.length&&<section className="application-detail-section" aria-label="Recorded agent actions"><h4>Recorded agent actions</h4><ul>{progress.actionEvidence.map(text=><li key={text}>{text}</li>)}</ul></section>}
    <dl className="application-request-facts"><div><dt>CV for this application</dt><dd>{application.cv?.name||'No CV attached'}{application.cv&&!attachedFile&&<small>Original file unavailable</small>}</dd></div><div><dt>Vacancy source</dt><dd>{sourceName(job)}{sourceUrl&&<a href={sourceUrl} target="_blank" rel="noopener noreferrer">View vacancy<ExternalLink size={12}/></a>}</dd></div><div><dt>Requested</dt><dd>{timestamp(application.at)}</dd></div></dl>
    {progress.group==='applied'&&<div className="application-confirmation"><ShieldCheck size={19}/><div><strong>Confirmation saved</strong><p>{application.result?.receipt||confirmation?.text}</p>{confirmationUrl&&<a href={confirmationUrl} target="_blank" rel="noopener noreferrer">Open confirmation page<ExternalLink size={12}/></a>}<small>{application.receiptVerification?`Matched the role, employer, recipient, date and authenticated sender. Received ${timestamp(application.receiptVerification.receivedAt)}.`:'The browser agent recorded this evidence. Check your email for any employer follow-up.'}</small></div></div>}
    {application.status==='processing'&&!handoffInQuestions&&<ApplicationVerificationHandoff requestId={application.id}/>}
    {(application.status==='processing'||manualDisplaySession(application))&&<ApplicationManualSubmit requestId={application.id} onHealth={next=>reportHealth(application.id,next)}/>}
    {(!!applicationFormQuestions(application,employerQuestions).length||!!application.confirmedAnswers?.length)&&<ApplicationQuestionAnswers key={`${application.id}-${application.cv?.fileId||''}`} application={application} employerQuestions={employerQuestions} accountProfile={accountProfile} busy={busy} onRefreshChoices={()=>onRefreshChoices(application.id)} onSave={answers=>onAnswer(application.id,answers)}/>}
    {!!application.confirmedAnswers?.length&&<details className="application-saved-draft"><summary>Review your saved answers ({application.confirmedAnswers.length})</summary><dl>{application.confirmedAnswers.map((answer,index)=><div className="application-detail-section" key={`${answer.question}-${index}`}><dt><strong>{answer.question}</strong></dt><dd style={{margin:0,whiteSpace:'pre-wrap'}}>{answer.value}</dd></div>)}</dl></details>}
    {prepareVerification&&progress.canQueue&&<p className="subtle">The earlier browser session has ended. Prepare this same unsent request with your selected CV and saved answers to open a new agent browser. Then answer the human/AI dropdown there and return control. Previously delivered or uncertain requests cannot be restarted here.</p>}
    <div className="application-overview-actions">
     {applyUrl&&<ApplicationBrowserButton url={applyUrl}/>}
     {application.agentVersion===2&&<div className="application-video-actions" role="group" aria-label="Application video"><a id={'watch-live-'+application.id} className="button quiet" href={'/application-watch?request='+encodeURIComponent(application.id)} target="_blank" rel="noopener noreferrer" title={['queued','processing'].includes(application.status)?'Watch live (opens in a new tab)':'Open live viewer for session status and recording (opens in a new tab)'}><Eye size={15}/>Watch live<ExternalLink size={13}/><span className="sr-only"> (opens in a new tab)</span></a><a id={'watch-recording-'+application.id} className="button quiet" href={'/application-watch?request='+encodeURIComponent(application.id)+'&mode=recording'} target="_blank" rel="noopener noreferrer" title="Watch recording (opens in a new tab)"><Eye size={15}/>Watch recording<ExternalLink size={13}/><span className="sr-only"> (opens in a new tab)</span></a></div>}
     {progress.canQueue&&!!attachedFile&&!needsUpdate&&(!answeringQuestions||prepareVerification)&&(agentEnabled?<button type="button" className="button" disabled={busy} onClick={()=>void onQueue(application.id)}><Bot size={15}/>{prepareVerification?'Prepare this application with the updated agent':application.confirmedAnswers?.length?'Continue with my answers':'Continue automatic application'}</button>:<a className="button" href="/account#application-agent-heading"><Bot size={15}/>Connect agent to apply</a>)}
     {canUpdate&&<button type="button" className="button" disabled={busy} onClick={()=>void onRefresh(application.id)}><FileText size={15}/>{application.cv?'Update request with chosen CV':'Attach chosen CV'}</button>}
     {!attachedFile&&!chosenCv&&progress.group==='needs_you'&&<button type="button" className="button" onClick={onChooseCv}><FileText size={15}/>Choose a CV</button>}
     {attachedFile&&<a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}?view=1`} target="_blank" rel="noopener noreferrer"><Eye size={15}/>View application CV</a>}
     <button className="button quiet danger" type="button" disabled={busy||application.status==='processing'} onClick={()=>setDeleteTarget({scope:'application',applicationId:application.id,label:`${job?.title||'Application'}${job?.company?` · ${job.company}`:''}`})}><Trash2 size={15}/>Delete application</button>
    </div>
    <details className="application-detail-panel"><summary>Application details and agent report</summary>
     {application.report?<AgentReport value={application.report}/>:<p className="subtle">The agent’s answers, experience calculation, company research and cover letter will appear here after it reports back.</p>}
     {job&&<div className="application-detail-section"><h4>Jobs you might like</h4>{similarJobs(job,jobs).slice(0,3).map(other=><p key={other.id}><a className="text-link" href={'/workspace?view=search&job='+encodeURIComponent(other.id)}>{other.title} · {other.company}</a></p>)}{!similarJobs(job,jobs).length&&<p className="subtle">No similar roles in your collection yet.</p>}</div>}
     <div className="application-detail-section"><h4>Recorded activity</h4><ol className="application-event-list">{progress.events.map((event,index)=><li key={`${event.label}-${index}`}><span>{event.label}</span><time dateTime={event.at}>{timestamp(event.at)}</time></li>)}</ol></div>
     <div className="application-detail-section"><h4>Files and source</h4><div className="application-overview-actions">{attachedFile&&<a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}`} download><Download size={15}/>Download application CV</a>}{applyUrl&&<ApplicationBrowserButton url={applyUrl}/>}{canChangeCv&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void onRefresh(application.id)}>Use {chosenCv!.name} instead</button>}</div></div>
     <a className="button quiet" href={`/workspace?view=cover-letters&job=${encodeURIComponent(application.jobId)}`}>Generate cover letter</a>{application.coverLetter&&<p className="subtle">Reviewed cover letter attached · version {application.coverLetter.version}</p>}{draft&&<details className="application-saved-draft"><summary>Earlier saved draft for manual use</summary><p className="subtle">This is your saved draft. The agent prepares its own cover letter, shown in its report above.</p><pre className="snapshot-text">{draft.text}</pre></details>}
    </details>
   </li>;
  })}</ol>:<div className="panel application-overview-empty"><span className="agent-tracker-icon"><FileText size={25}/></span><h3>{ordered.length?'No applications in this view':'Your next application starts in Explore'}</h3><p>{ordered.length?'Try another status or search for a different role or company.':'Swipe Apply on a role. With your CV and agent connected, its progress will appear here.'}</p>{ordered.length?<button className="button quiet" type="button" onClick={()=>{setFilter('all');setSearch('');}}>Show all applications</button>:<button className="button" type="button" onClick={onExplore}>Explore jobs<ArrowRight size={15}/></button>}</div>}
 </div>
 {deleteTarget&&!sessionLocked&&<ApplicationDeleteDialog target={deleteTarget} busy={busy} onCancel={closeDelete} onDelete={deleteRecords}/>}
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
