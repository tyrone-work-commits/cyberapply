"use client";
import {useEffect,useState} from 'react';
import type {EmployerQuestion} from '@/lib/employer-questions';
import {manualAnswerOnly,jobBoundAnswer} from '@/lib/employer-questions';
type Packet={revision:number;state:{accountProfile:import('@/lib/cyber-domain').AccountProfile}};
export function EmployerQuestions({items,revision,onSaved,disabled=false,onBusyChange}:{items:EmployerQuestion[];revision:number;onSaved:(packet:Packet)=>void;disabled?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(''),[message,setMessage]=useState('');
 async function save(item:EmployerQuestion,answer:string){if(busy||disabled)return;setBusy(item.id);onBusyChange?.(true);setMessage('');try{
  const r=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,action:{type:'save_employer_answer',questionId:item.id,answer}})});const p=await r.json() as Packet&{error?:string;message?:string};if(!r.ok)throw Error(p.error||'Could not save this answer.');onSaved(p);setMessage(p.message||'Answer saved.');
 }catch(error){setMessage((error as Error).message);}finally{setBusy('');onBusyChange?.(false);}}
 return <fieldset className="application-detail-section"><legend>Saved employer questions</legend><p>Open any question to edit its answer, then select Save answer. Your saved factual answer takes priority for that exact question when the agent next starts an application and the form’s choices match.</p><p className="subtle">These edits do not change your general profile fields. Keep those up to date too. Salary and job-specific answers stay with their original job. Saving an answer does not restart or submit an application.</p><p className="subtle">Verification and employer-consent answers can be edited as personal references. They do not automatically complete verification or authorize an employer’s consent request. New employer questions are added after the agent reports, including questions it could not answer. Earlier saved answers are kept.</p>
 {!items.length?<p className="subtle">Encountered questions will appear after your agent reports on an application.</p>:items.map(item=><Question key={item.id} item={item} busy={!!busy||disabled} saving={busy===item.id} save={answer=>void save(item,answer)}/>)}
 {message&&<p role="status">{message}</p>}</fieldset>;
}
function Question({item,busy,saving,save}:{item:EmployerQuestion;busy:boolean;saving:boolean;save:(value:string)=>void}){
 const [answer,setAnswer]=useState(item.answer);useEffect(()=>setAnswer(item.answer),[item.id,item.answer]);
 const reference=manualAnswerOnly(item.question,[...item.options,answer])||item.reusePolicy==='manual_only';const scoped=item.jobSpecific||jobBoundAnswer(item.question);
 const inputId='employer-answer-'+item.id;
 return <details className="application-detail-section"><summary>{item.question} · {reference?'Reference only':item.status==='answered'?'Answer saved':'Needs answer'} · Edit answer</summary><p className="subtle">{item.source==='cv_and_job'?'Generated from CV evidence and the role':item.source==='cv'?'From your chosen CV':item.source==='edit_profile'?'Previously filled from general profile fields':item.source==='user'?'Supplied by you':'No answer was established'}. {scoped?`Used only for ${item.company||'its original employer'}${item.jobTitle?' · '+item.jobTitle:'.'}`:''}</p>
 <label htmlFor={inputId}>Your answer<textarea id={inputId} aria-label={'Answer to: '+item.question} maxLength={2000} value={answer} disabled={busy} onChange={event=>setAnswer(event.target.value)}/></label>
 {!!item.options.length&&<small>Earlier offered choices: {item.options.join(' / ')}. Use an offered choice when answering a dropdown.</small>}
 {reference&&<p className="subtle">Personal reference only. The agent will still pause for you to complete employer verification or give consent for that specific application.</p>}
 <button className="button quiet" type="button" disabled={busy} onClick={()=>save(answer)}>{saving?'Saving answer…':reference?'Save reference answer':'Save answer'}</button>
 {item.source==='user'&&<small>Saved {new Date(item.updatedAt).toLocaleString()}. {item.reusePolicy==='manual_only'?'Reference only.':scoped?'Applies to the original job.':'Used for this exact question.'}</small>}
 {item.evidence&&<p className="subtle">Basis: {item.evidence}</p>}</details>;
}
