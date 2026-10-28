import { ArrowRight, Download, ExternalLink, Eye, FileText } from 'lucide-react';
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

export function ApplicationOverview({ applications, jobs, drafts, files, selectedCvId, busy, onRefresh, onChooseCv }: {
  applications: ApplicationRequest[];
  jobs: Job[];
  drafts: Draft[];
  files: Attachment[];
  selectedCvId?: string;
  busy: boolean;
  onRefresh: (id:string)=>Promise<void>;
  onChooseCv: ()=>void;
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
      const refreshNeeded=!!chosenCv&&['needs_action','queued','needs_attention','failed'].includes(application.status)&&(application.cv?.fileId!==chosenCv.id||application.reason!=='connection_required');
      return <li key={application.id} className="panel application-overview-card">
        <div className="application-overview-main">
          <div>
            <span className="eyebrow">APPLY REQUEST · {new Date(application.at).toLocaleDateString()}</span>
            <h3>{job?.title || 'Job listing unavailable'}</h3>
            <p>{job?.company || 'Employer not available'}{job?.location ? ` · ${job.location}` : ''}</p>
          </div>
          <span className="badge">{application.status==='applied'?'APPLIED':application.status==='processing'||application.status==='uncertain'?'CHECK OUTCOME':application.status==='queued'?'NOT SUBMITTED':application.status==='needs_attention'?'NEEDS ATTENTION':'NOT SUBMITTED'}</span>
        </div>
        <p className="application-overview-source"><strong>Vacancy source:</strong> {sourceName(job)}</p>
        <p className="application-overview-source"><strong>CV for this request:</strong> {application.cv?.name||'No CV attached'}{application.cv&&!attachedFile?' · original file unavailable':''}</p>
        <p className="application-overview-status">{application.result?`${application.result.message}${application.result.receipt?` Confirmation: ${application.result.receipt}`:''}`:application.status==='queued'?'The previous local agent has been removed. This request was not submitted.':application.status==='processing'||application.status==='uncertain'?'The previous agent may have started this request. Check with the employer before trying again.':!application.cv?'Choose a saved CV and attach it to this request before applying.':!attachedFile?'The original CV file has been deleted. Choose another CV and update this request.':application.reason==='materials_changed'?'Your CV or candidate facts changed after this request. Update the materials before applying.':!application.candidate.reviewed?'Review your candidate facts and CV before using these materials on the employer site.':'No automatic application agent is connected. Open the original application page if you want to submit now.'}</p>
        <div className="application-overview-actions">
          {attachedFile&&<><a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}?view=1`} target="_blank" rel="noopener noreferrer">View chosen CV<Eye size={15}/></a><a className="button quiet" href={`/api/files/${encodeURIComponent(attachedFile.id)}`} download>Download chosen CV<Download size={15}/></a></>}
          {refreshNeeded&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void onRefresh(application.id)}>{application.cv?'Update request with chosen CV':'Attach chosen CV'}<FileText size={15}/></button>}
          {!chosenCv&&<button type="button" className="button quiet" onClick={onChooseCv}>Choose a CV<ArrowRight size={15}/></button>}
          {sourceUrl && <a className="button quiet" href={sourceUrl} target="_blank" rel="noopener noreferrer">View original vacancy<ExternalLink size={15}/></a>}
          {applyUrl && applyUrl !== sourceUrl && <a className="button quiet" href={applyUrl} target="_blank" rel="noopener noreferrer">Open application page<ExternalLink size={15}/></a>}
          {boardUrl && boardUrl !== sourceUrl && <a className="button text-button" href={boardUrl} target="_blank" rel="noopener noreferrer">Employer job board<ArrowRight size={15}/></a>}
          {draftIds.has(application.draftId) && <a className="button text-button" href={`#application-materials-${application.draftId}`}>Review materials<ArrowRight size={15}/></a>}
        </div>
      </li>;
    })}</ol> : <div className="panel application-overview-empty"><FileText size={26}/><strong>No Apply requests yet</strong><p>Choose Apply on a role in Explore. Once your candidate facts are confirmed, it will appear here.</p></div>}
  </section>;
}
