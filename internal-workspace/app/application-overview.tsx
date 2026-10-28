"use client";
import { useState } from 'react';
import { ArrowRight, Bot, Check, Download, ExternalLink, Eye, FileText } from 'lucide-react';
import type { ApplicationRequest, Attachment, Draft, Job } from '@/lib/cyber-domain';

function httpsUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function sourceName(job?: Job) {
  if (!job?.source) return 'Listing you added · source not independently verified';
  return `${job.source.provider === 'greenhouse' ? 'Greenhouse' : 'Lever'} · ${job.company}`;
}

export function ApplicationOverview({ applications, jobs, drafts, files, selectedCvId, busy, onRefresh, onChooseCv, onQueue, onAnswer }: {
  applications: ApplicationRequest[];
  jobs: Job[];
  drafts: Draft[];
  files: Attachment[];
  selectedCvId?: string;
  busy: boolean;
  onRefresh: (id:string)=>Promise<void>;
  onChooseCv: ()=>void;
  onQueue: (id:string)=>Promise<void>;
  onAnswer: (id:string,answers:{question:string;value:string}[])=>Promise<void>;
}) {
  const draftIds = new Set(drafts.map(draft => draft.id));
  const chosenCv=files.find(file=>file.id===selectedCvId);
  const ordered = [...applications].sort((a, b) => b.at.localeCompare(a.at));
  return <section className="application-overview" aria-labelledby="application-overview-title">
    <div className="section-title">
      <h2 id="application-overview-title">Jobs you chose to Apply to</h2>
      <span>{ordered.length} {ordered.length === 1 ? 'request' : 'requests'}</span>
    </div>
    <p className="subtle application-overview-intro">This list tracks your choices in CyberApply. Each request keeps the CV chosen when it was saved. A saved Apply request is not proof that the employer received an application.</p>
    <p className="subtle application-overview-intro">CV chosen for new requests: <strong>{chosenCv?.name||'None'}</strong> <button type="button" className="text-link" onClick={onChooseCv}>Choose a CV</button></p>
    {ordered.length ? <ol className="application-overview-list">{ordered.map(application => {
      const job = jobs.find(item => item.id === application.jobId);
      const sourceUrl = httpsUrl(application.sourceUrl);
      const applyUrl = httpsUrl(job?.applyUrl) || sourceUrl;
      const boardUrl = httpsUrl(job?.source?.boardUrl);
      const attachedFile=files.find(file=>file.id===application.cv?.fileId);
      const refreshNeeded=!!chosenCv&&['needs_action','queued','needs_attention','failed'].includes(application.status)&&(application.cv?.fileId!==chosenCv.id||['materials_changed','cv_required','candidate_review_required'].includes(application.reason||''));
      return <li key={application.id} className="panel application-overview-card">
        <div className="application-overview-main">
          <div>
            <span className="eyebrow">APPLY REQUEST · {new Date(application.at).toLocaleDateString()}</span>
            <h3>{job?.title || 'Job listing unavailable'}</h3>
            <p>{job?.company || 'Employer not available'}{job?.location ? ` · ${job.location}` : ''}</p>
          </div>
          <span className="badge">{application.status==='applied'?'APPLIED':application.status==='processing'?'APPLYING':application.status==='uncertain'?'CHECK OUTCOME':application.status==='queued'?'QUEUED':application.status==='needs_attention'?'NEEDS ATTENTION':'NOT SUBMITTED'}</span>
        </div>
        <p className="application-overview-source"><strong>Vacancy source:</strong> {sourceName(job)}</p>
        <p className="application-overview-source"><strong>CV for this request:</strong> {application.cv?.name||'No CV attached'}{application.cv&&!attachedFile?' · original file unavailable':''}</p>
        <p className="application-overview-status">{application.result?`${application.result.message}${application.result.receipt?` Confirmation: ${application.result.receipt}`:''}`:application.status==='queued'?'Waiting for your connected browser runner. Keep it open on your computer to work through this application.':application.status==='processing'?'The agent is working on the employer website with this request’s chosen CV. Submission is not confirmed yet.':application.status==='uncertain'?'The submission outcome is unknown. Check with the employer before trying again.':!application.cv?'Choose a saved CV and attach it to this request before applying.':!attachedFile?'The original CV file has been deleted. Choose another CV and update this request.':application.reason==='materials_changed'?'Your CV or application materials changed after this request. Update them before applying.':application.reason==='candidate_review_required'?'This older request needs an updated CV snapshot. Use Update request with chosen CV, then review its draft.':'Connect the CV application agent in Settings, then queue this request to apply using its chosen CV.'}</p>
        {application.report&&<AgentReport value={application.report}/>}
        {application.status==='needs_attention'&&<ApplicationQuestionAnswers key={application.id} application={application} busy={busy} onSave={answers=>onAnswer(application.id,answers)}/>}
        <div className="application-overview-actions">
          {attachedFile&&['needs_action','needs_attention','failed'].includes(application.status)&&!refreshNeeded&&<button type="button" className="button" disabled={busy} onClick={()=>void onQueue(application.id)}><Bot size={15}/>Queue application agent</button>}
          {attachedFile&&<><a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}?view=1`} target="_blank" rel="noopener noreferrer">View chosen CV<Eye size={15}/></a><a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}`} download>Download chosen CV<Download size={15}/></a></>}
          {refreshNeeded&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void onRefresh(application.id)}>{application.cv?'Update request with chosen CV':'Attach chosen CV'}<FileText size={15}/></button>}
          {!chosenCv&&<button type="button" className="button quiet" onClick={onChooseCv}>Choose a CV<ArrowRight size={15}/></button>}
          {sourceUrl && <a className="button quiet" href={sourceUrl} target="_blank" rel="noopener noreferrer">View original vacancy<ExternalLink size={15}/></a>}
          {applyUrl && applyUrl !== sourceUrl && <a className="button quiet" href={applyUrl} target="_blank" rel="noopener noreferrer">Open application page<ExternalLink size={15}/></a>}
          {boardUrl && boardUrl !== sourceUrl && <a className="button text-button" href={boardUrl} target="_blank" rel="noopener noreferrer">Employer job board<ArrowRight size={15}/></a>}
          {draftIds.has(application.draftId) && <a className="button text-button" href={`#application-materials-${application.draftId}`}>Review materials<ArrowRight size={15}/></a>}
        </div>
      </li>;
    })}</ol> : <div className="panel application-overview-empty"><FileText size={26}/><strong>No Apply requests yet</strong><p>Choose Apply on a role in Explore to save a request here.</p></div>}
  </section>;
}

function ApplicationQuestionAnswers({application,busy,onSave}:{application:ApplicationRequest;busy:boolean;onSave:(answers:{question:string;value:string}[])=>Promise<void>}){
 const raw=Array.isArray(application.report?.unresolved)?application.report.unresolved:[];
 const questions=[...new Map(raw.filter(item=>item&&typeof item==='object'&&typeof (item as Record<string,unknown>).question==='string').map(item=>{
  const entry=item as Record<string,unknown>,question=String(entry.question).slice(0,1000);
  return [question,{question,reason:typeof entry.reason==='string'?entry.reason:''}] as const;
 })).values()].filter(item=>item.question.trim()).slice(0,40);
 const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries((application.confirmedAnswers||[]).map(item=>[item.question,item.value])));
 const [confirmed,setConfirmed]=useState(false);
 const answers=questions.map(item=>({question:item.question,value:(values[item.question]||'').trim()})).filter(item=>item.value);
 if(!questions.length)return null;
 return <form className="application-question-answers" onSubmit={event=>{event.preventDefault();if(!busy&&confirmed&&answers.length)void onSave(answers);}}>
  <h4>Answer this employer’s questions</h4>
  <p className="subtle">These answers are saved for this application only. Read each question carefully and enter only facts you can confirm. Leave an answer blank if you are unsure; the agent will keep that question paused.</p>
  {questions.map((item,index)=><label key={item.question} htmlFor={`application-answer-${application.id}-${index}`}>{item.question}<textarea id={`application-answer-${application.id}-${index}`} rows={2} maxLength={2000} value={values[item.question]||''} disabled={busy} onChange={event=>{setValues({...values,[item.question]:event.target.value});setConfirmed(false);}}/>{item.reason&&<span className="label-hint">{item.reason}</span>}</label>)}
  <p className="subtle">For a checkbox or consent question, enter “Yes” only if you personally agree to its exact wording above for this employer. Enter “No” to decline. The agent will not choose an opt-in for you.</p>
  <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>I confirm that these answers are accurate. Any “Yes” I entered for a consent or checkbox question is my explicit choice for that exact question in this application.</span></label>
  <button type="submit" className="button quiet" disabled={busy||!confirmed||!answers.length}><Check size={16}/>Save my answers</button>
  <p className="subtle">After saving, choose Queue application agent to try this application again with your confirmed answers.</p>
 </form>;
}

function AgentReport({value}:{value:unknown}){
 if(!value||typeof value!=='object')return null;
 const report=value as Record<string,unknown>;
 const answers=Array.isArray(report.answers)?report.answers.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 const unresolved=Array.isArray(report.unresolved)?report.unresolved.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 const experience=report.experience&&typeof report.experience==='object'?report.experience as Record<string,unknown>:null;
 const research=report.research&&typeof report.research==='object'?report.research as Record<string,unknown>:null;
 const findings=Array.isArray(research?.company_findings)?research.company_findings.filter(item=>item&&typeof item==='object') as Record<string,unknown>[]:[];
 return <details><summary>Agent preparation and evidence</summary>
  {experience&&<><h4>Cybersecurity experience found in this CV</h4><p>{experience.established?`${experience.years} years${experience.approximate?' (approximately)':''}`:'Not established from dated work history'}. {String(experience.note||'')}</p></>}
  {!!findings.length&&<><h4>Company research</h4><ul>{findings.map((finding,index)=><li key={index}>{String(finding.text||'')}{typeof finding.source_url==='string'&&httpsUrl(finding.source_url)&&<> <a href={httpsUrl(finding.source_url)!} target="_blank" rel="noopener noreferrer">Source</a></>}</li>)}</ul></>}
  {typeof report.cover_letter==='string'&&<><h4>Tailored cover letter</h4><pre className="snapshot-text">{report.cover_letter}</pre></>}
  {!!answers.length&&<><h4>Answers prepared from your CV and research</h4><ul>{answers.map((answer,index)=><li key={index}><strong>{String(answer.question||answer.label||answer.field_id||'Form question')}</strong>: {String(answer.value??'')}<p className="subtle">{String(answer.source||'')}{answer.evidence?` · ${typeof answer.evidence==='string'?answer.evidence:JSON.stringify(answer.evidence)}`:''}</p></li>)}</ul></>}
  {!!unresolved.length&&<><h4>Questions that need your input</h4><ul>{unresolved.map((item,index)=><li key={index}><strong>{String(item.question||'Form question')}</strong><p className="subtle">{String(item.reason||'Please review this answer.')}</p></li>)}</ul></>}
 </details>;
}
