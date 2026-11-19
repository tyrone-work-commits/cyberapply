'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ExternalLink,Layers,LoaderCircle,X} from 'lucide-react';
import {bulkApplyCandidates,selectedCv,type Job,type State} from '@/lib/cyber-domain';
import {CLOSER_CV_MATCH,closerCvMatch,rankBatchJobs,validBatchSelection,type BatchJobMatch} from '@/lib/batch-job-selection';
import {sourceLabel} from '@/lib/job-catalog';
import './explore-batch-apply.css';

type Batch={jobs:BatchJobMatch[];count:5|10;cvId:string;cvName:string;operationId:string};
export default function ExploreBatchApply({state,jobs,busy,onChooseCv,onApply}:{state:State;jobs:Job[];busy:boolean;onChooseCv:()=>void;onApply:(ids:string[],cvId:string,operationId:string)=>Promise<boolean>}){
 const [batch,setBatch]=useState<Batch|null>(null),[saving,setSaving]=useState(false),[failure,setFailure]=useState('');
 const available=bulkApplyCandidates(state,jobs),cv=selectedCv(state),readable=!!cv&&state.profile.resumeText.trim().length>=20;
 function preview(count:5|10){if(!cv||!readable||busy||available.length<count)return;setFailure('');setBatch({jobs:rankBatchJobs(state,available),count,cvId:cv.id,cvName:cv.name,operationId:crypto.randomUUID()});}
 async function apply(ids:string[]){if(!batch||saving||busy||!validBatchSelection(batch.jobs,ids,batch.count))return;setSaving(true);setFailure('');try{if(await onApply(ids,batch.cvId,batch.operationId))setBatch(null);else setFailure('The batch could not be confirmed. Close this picker and reload your saved data before trying again.');}catch{setFailure('The batch could not be confirmed. Close this picker and reload your saved data before trying again.');}finally{setSaving(false);}}
 return <><section className="explore-batch-apply" aria-label="Apply to multiple jobs"><div><strong><Layers size={17}/>Apply to multiple jobs</strong><small>Compare CV matches and choose 5 or 10 jobs.</small></div><div className="explore-batch-buttons">{([5,10] as const).map(count=><button key={count} type="button" className="button quiet" disabled={busy||!readable||available.length<count} onClick={()=>preview(count)} aria-haspopup="dialog">Apply to {count}</button>)}</div>{!readable?<p><button className="text-button" type="button" disabled={busy} onClick={onChooseCv}>Choose a readable CV</button> to use for these applications.</p>:available.length<10?<p>{available.length} available job {available.length===1?'vacancy':'vacancies'} in the Explore page, refresh for more.</p>:null}</section>
 {batch&&<BatchPicker batch={batch} saving={saving} busy={busy} failure={failure} onClose={()=>{if(!saving)setBatch(null);}} onApply={ids=>void apply(ids)}/>}</>;
}
function BatchPicker({batch,saving,busy,failure,onClose,onApply}:{batch:Batch;saving:boolean;busy:boolean;failure:string;onClose:()=>void;onApply:(ids:string[])=>void}){
 const ref=useRef<HTMLDialogElement>(null),[selected,setSelected]=useState<string[]>([]);
 const closer=batch.jobs.filter(closerCvMatch),[filter,setFilter]=useState<'closer'|'all'|'selected'>(closer.length?'closer':'all');
 const shown=filter==='closer'?closer:filter==='selected'?batch.jobs.filter(item=>selected.includes(item.job.id)):batch.jobs;
 const disabled=saving||busy||!!failure,valid=validBatchSelection(batch.jobs,selected,batch.count);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.showModal();return()=>previous?.focus?.();},[]);
 function toggle(id:string){if(disabled)return;setSelected(current=>current.includes(id)?current.filter(value=>value!==id):current.length<batch.count?[...current,id]:current);}
 return <dialog ref={ref} className="modal explore-batch-preview" aria-labelledby="bulk-apply-title" onCancel={event=>{event.preventDefault();if(!saving)onClose();}}>
 <div className="modal-head"><h2 id="bulk-apply-title">Choose {batch.count} jobs to apply for</h2><button type="button" className="button icon-button quiet" aria-label="Close batch picker" disabled={saving} onClick={onClose}><X size={19}/></button></div>
 <p>Using <strong>{batch.cvName}</strong>. Open each job’s details, compare its CV skill match, then select the jobs you want.</p>
 <p className="subtle batch-match-explanation">Closer matches have at least {CLOSER_CV_MATCH}% of their listed skill keywords found in this CV. This comparison does not verify eligibility or predict hiring success.</p>
 <div className="batch-match-filters" role="group" aria-label="Filter jobs by CV match">{([['closer',`Closer CV matches (${closer.length})`],['all',`All available (${batch.jobs.length})`],['selected',`Selected (${selected.length})`]] as const).map(([value,label])=><button key={value} type="button" className="button quiet" aria-pressed={filter===value} disabled={saving} onClick={()=>setFilter(value)}>{label}</button>)}</div>
 <p className="batch-selection-count" role="status" aria-live="polite">{selected.length} of {batch.count} jobs selected{selected.length===batch.count?'. Ready to apply.':`. Choose ${batch.count-selected.length} more.`}</p>
 {closer.length>0&&closer.length<batch.count&&filter==='closer'&&<p className="subtle">There are {closer.length} closer CV matches. You can view All available to choose the rest.</p>}
 {!shown.length&&<p className="subtle">{filter==='selected'?'No jobs selected yet.':filter==='closer'?'No closer skill matches were found in the loaded vacancies. You can view All available and inspect the details.':'No jobs to show.'}</p>}
 <ul className="batch-job-list">{shown.map(item=>{const {job,score,matched,missing}=item,checked=selected.includes(job.id);return <li key={job.id} className={checked?'batch-job-option is-selected':'batch-job-option'}>
 <label className="batch-job-choice"><input type="checkbox" aria-label={`Select ${job.title} at ${job.company}`} checked={checked} disabled={disabled||!checked&&selected.length>=batch.count} onChange={()=>toggle(job.id)}/><span><strong>{job.title}</strong><span className="batch-job-company">{job.company} · {job.location||'Location not supplied'} · {job.workMode}</span></span></label>
 <span className={closerCvMatch(item)?'batch-job-fit is-closer':'batch-job-fit'}>{score===null?'CV skill match unavailable':`${score}% CV skill match`}</span>
 <details className="batch-job-details"><summary>View job details<ChevronDown size={16}/></summary><div className="batch-job-detail-content"><p><strong>Skills found in your CV:</strong> {matched.length?matched.join(', '):'None of the listed skill keywords found.'}</p><p><strong>Listed skills not found in your CV:</strong> {missing.length?missing.join(', '):job.skills.length?'None.':'No skill keywords supplied for this listing.'}</p><p className="batch-job-source"><strong>Source:</strong> {sourceLabel(job)}</p><h3>Job description</h3><p className="batch-job-description">{job.description||'No description supplied. Open the original vacancy for details.'}</p>{job.source?.descriptionTruncated&&<p className="subtle">This imported description was shortened. Open the original vacancy for the full details.</p>}<a className="button quiet" href={job.url} target="_blank" rel="noopener noreferrer">Open original vacancy<ExternalLink size={14}/></a></div></details>
 </li>;})}</ul>
 <p className="subtle">Your selected jobs get separate requests in Applications, using this CV, your Account Profile and saved Answers library. The agent pauses for missing information or verification. Greenhouse and reCAPTCHA forms still need you to press the final Submit button.</p>
 {failure&&<p className="inline-error" role="alert">{failure}</p>}
 <div className="form-foot batch-picker-footer"><button type="button" className="button quiet" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="button" disabled={disabled||!valid} onClick={()=>onApply(batch.jobs.filter(item=>selected.includes(item.job.id)).map(item=>item.job.id))}>{saving?<><LoaderCircle className="spin" size={16}/>Saving requests…</>:`Apply to these ${batch.count} jobs`}</button></div></dialog>;
}
