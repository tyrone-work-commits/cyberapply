"use client";
import {useState} from 'react';
import type {EmployerQuestion} from '@/lib/employer-questions';
import {questionNeedsDirectFacts} from '@/lib/employer-questions';
export function EmployerQuestions({items,revision,onSaved}:{items:EmployerQuestion[];revision:number;onSaved:(packet:{revision:number;state:{accountProfile:import('@/lib/cyber-domain').AccountProfile}})=>void}){
 const [busy,setBusy]=useState(''),[message,setMessage]=useState('');
 async function save(item:EmployerQuestion,answer:string){setBusy(item.id);setMessage('');try{
  const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,action:{type:'save_employer_answer',questionId:item.id,answer}})});const p=await r.json() as {error?:string;message?:string;revision:number;state:{accountProfile:import('@/lib/cyber-domain').AccountProfile}};if(!r.ok)throw Error(p.error||'Could not save this answer.');onSaved(p);setMessage(p.message||'Answer saved.');
 }catch(error){setMessage((error as Error).message);}finally{setBusy('');}}
 return <fieldset className="application-detail-section"><legend>Saved employer questions</legend><p>The agent adds encountered questions here and answers them from your chosen CV and Account Profile. Supported generated explanations and cover letters run automatically. You can supply a missing factual answer once for future reuse.</p><p className="subtle">Up to 40 recent questions are kept. CV/profile answers are recalculated from current information; company-specific prose is regenerated for each job. Consent and missing personal facts cannot be invented.</p>
 {!items.length?<p className="subtle">Questions will appear after your agent reports on an application.</p>:items.map(item=><Question key={item.id+'-'+item.updatedAt} item={item} busy={!!busy} save={answer=>void save(item,answer)}/>)}
 {message&&<p role="status">{message}</p>}</fieldset>;
}
function Question({item,busy,save}:{item:EmployerQuestion;busy:boolean;save:(value:string)=>void}){
 const [answer,setAnswer]=useState(item.answer);const managed=item.source==='edit_profile'||questionNeedsDirectFacts(item.question);
 return <details className="application-detail-section"><summary>{item.question} · {item.status==='answered'?'Answer saved':'Needs facts'}</summary><p className="subtle">{item.source==='cv_and_job'?'Generated from CV evidence and the role':item.source==='cv'?'From your chosen CV':item.source==='edit_profile'?'From dedicated Edit Profile fields':item.source==='user'?'Supplied by you':'The saved information did not establish an answer'}. {item.jobSpecific?'Job-specific; not copied to unrelated roles.':''}</p>
 {managed?<><p style={{whiteSpace:'pre-wrap'}}>{item.answer||'No supported answer saved.'}</p><small>Use the dedicated profile fields for personal details and eligibility. Employer-specific consent still needs your decision for that application.</small></>:<><label>Answer for this exact question<textarea maxLength={2000} value={answer} onChange={event=>setAnswer(event.target.value)}/></label>{!!item.options.length&&<small>Earlier offered choices: {item.options.join(' / ')}</small>}<button className="button quiet" type="button" disabled={busy} onClick={()=>save(answer)}>Save answer for reuse</button></>}
 {item.evidence&&<p className="subtle">Basis: {item.evidence}</p>}</details>;
}
