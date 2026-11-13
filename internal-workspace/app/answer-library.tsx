'use client';
import {useEffect,useRef,useState} from 'react';
import {manualAnswerOnly,openEndedQuestion,type EmployerQuestion} from '@/lib/employer-questions';
import {careerRequest as request} from '@/lib/career-client';
import './answer-library.css';

type Packet={revision:number;state:{accountProfile?:{employerQuestions?:EmployerQuestion[]}};message?:string};

export default function AnswerLibrary({onUpdated}:{onUpdated:()=>Promise<void>}){
 const [items,setItems]=useState<EmployerQuestion[]>([]),[revision,setRevision]=useState(0);
 const [values,setValues]=useState<Record<string,string>>({}),[tab,setTab]=useState<'auto'|'past'>('past');
 const [busy,setBusy]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[query,setQuery]=useState('');
 const locked=useRef(false);
 async function load(){
  setLoading(true);setError('');
  try{const r=await request<{answers:EmployerQuestion[];revision:number}>('/api/application-actions');setItems(r.answers);setRevision(r.revision);setValues(Object.fromEntries(r.answers.map(q=>[q.id,q.answer])));}
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[]);
 function applyPacket(packet:Packet){
  const next=packet.state.accountProfile?.employerQuestions||[];
  setValues(current=>Object.fromEntries(next.map(q=>{
   const previous=items.find(old=>old.id===q.id);
   return[q.id,previous&&previous.answer===q.answer&&current[q.id]!==undefined?current[q.id]:q.answer];
  })));
  setItems(next);setRevision(packet.revision);
 }
 async function update(kind:'save'|'remove'|'draft'|'refresh',question?:EmployerQuestion){
  if(locked.current||loading)return;
  if(kind==='remove'&&!window.confirm('Remove this answer from your reusable library? Existing application records and saved history remain.'))return;
  locked.current=true;setBusy(kind+':'+(question?.id||'all'));setError('');setNotice('');
  try{
   const packet=await request<Packet>(kind==='refresh'?'/api/employer-questions/refresh':'/api/workspace','POST',kind==='refresh'?{revision,questionId:question!.id}:{revision,action:
    kind==='save'?{type:'save_employer_answer',questionId:question!.id,answer:values[question!.id]||''}:
    kind==='remove'?{type:'delete_employer_answer',questionId:question!.id}:
    {type:'draft_employer_answers',...(question?{questionId:question.id}:{})}});
   applyPacket(packet);await onUpdated();
   setNotice(packet.message||(kind==='remove'?'Answer removed from reuse.':kind==='draft'?'CV-based drafts generated. Review them before saving an answer.':kind==='refresh'?'Employer choices refreshed.':'Answer saved. Future agent runs use the current allowed answer.'));
  }catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy('');}
 }
 const visible=items.filter(q=>(tab==='auto'?!!q.answer&&!manualAnswerOnly(q.question,[...q.options,q.answer])&&q.reusePolicy!=='manual_only':true)&&q.question.toLowerCase().includes(query.trim().toLowerCase()));
 const disabled=loading||!!busy;
 return <section className="career-answer-library" aria-label="Saved employer questions">
  <div><span className="eyebrow">YOUR ANSWERS, UNDER YOUR CONTROL</span><h2>Answers library.</h2></div>
  <p className="subtle">Answers you approve and save in Applications are added here automatically, including dropdown selections. You can edit them here; the agent reuses saved answers when the same question and offered choices match on another employer website. CV-based drafts and unanswered questions are also shown. Personal details and salary still come from Account Profile, and LinkedIn comes from the chosen CV.</p>
  <p className="subtle">Saving an answer does not restart or submit an application. Job-specific answers retain their context. Verification and employer-consent answers are personal references; the agent still needs the appropriate direct verification or consent.</p>
  {error&&<div role="alert" className="notice error">{error}<button type="button" className="button quiet" disabled={!!busy} onClick={()=>void load()}>Reload saved questions</button></div>}
  {notice&&<p role="status" className="notice success">{notice}</p>}
  <div className="career-segment"><button type="button" aria-pressed={tab==='past'} onClick={()=>setTab('past')}>All questions</button><button type="button" aria-pressed={tab==='auto'} onClick={()=>setTab('auto')}>Reusable answers</button></div>
  <label>Search questions<input maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label>
  <div><button type="button" className="button quiet" disabled={disabled||!items.length} onClick={()=>void update('draft')}>{busy==='draft:all'?'Generating drafts…':'Generate open-ended drafts'}</button><p className="subtle">Drafts use your chosen CV and saved job posting and remain labelled for review. Bulk generation keeps answers you have saved; generating a new draft for one question replaces that answer. Missing personal facts are not invented.</p></div>
  <p role="status" className="subtle">{loading?'Loading saved questions…':`${visible.length} of ${items.length} saved employer questions`}</p>
  {visible.map(q=>{
   const answer=values[q.id]??q.answer,reference=manualAnswerOnly(q.question,[...q.options,answer])||q.reusePolicy==='manual_only';
   const canDraft=openEndedQuestion(q.question,q.fieldType)&&!reference;
   return <section className="panel" key={q.id} aria-label={q.question}>
    <h3>{q.question}</h3>
    <p className="subtle">{q.source==='user'?'Your saved answer':q.source==='cv_and_job'?'Agent draft — review required':q.source==='missing'?'Not answered':q.source==='edit_profile'?'Account Profile':'Chosen CV'} · {reference?'Reference only':q.reusePolicy==='job_only'||q.jobSpecific?'Job context matters':'Exact matching questions'}</p>
    {q.options.length>0&&<><label>Employer’s offered choices<select aria-label={'Employer choices for: '+q.question} disabled={disabled} value={q.options.includes(answer)?answer:''} onChange={e=>{if(e.target.value)setValues(current=>({...current,[q.id]:e.target.value}));}}><option value="">Choose an option to edit your answer</option>{q.options.map((o,i)=><option key={i} value={o}>{o}</option>)}</select></label><p className="subtle">Captured choices{q.optionsCompany?' from '+q.optionsCompany:''}.{q.optionsTruncated?' This list is limited; review the employer form for the full list.':''} Selecting an option does not save or submit it.</p></>}
    <label>Your answer<textarea aria-label={'Answer to: '+q.question} maxLength={20000} disabled={disabled} value={answer} onChange={e=>setValues(current=>({...current,[q.id]:e.target.value}))}/></label>
    {!!q.options.length&&!!answer&&!q.options.includes(answer)&&<p className="subtle">Your current answer is not among the captured choices. Review the employer’s options before reusing it.</p>}
    {q.generationNote&&!q.generationNote.includes('not to use AI-written')&&<p className="subtle">{q.generationNote}</p>}
    <p className="subtle">{q.evidence}{q.lastUsedAt?' · Last used '+new Date(q.lastUsedAt).toLocaleString():''}</p>
    <div className="row-actions">
     <button type="button" className="button quiet" disabled={disabled||(!answer.trim()&&q.source!=='user')} onClick={()=>void update('save',q)}>{busy==='save:'+q.id?'Saving answer…':reference?'Save reference answer':'Save answer'}</button>
     {q.jobId.startsWith('greenhouse:')&&<button type="button" className="button quiet" disabled={disabled} onClick={()=>void update('refresh',q)}>Refresh employer choices</button>}
     {canDraft&&<button type="button" className="button quiet" disabled={disabled} onClick={()=>void update('draft',q)}>Generate new CV-based draft</button>}
     <button type="button" className="text-link" disabled={disabled} onClick={()=>void update('remove',q)}>Remove from reuse</button>
    </div>
   </section>;
  })}
  {!loading&&!visible.length&&<div className="panel"><h3>No questions in this view.</h3><p>New employer questions appear here after the agent reports on an application. Try another search or choose All questions to see unanswered and reference-only questions.</p></div>}
 </section>;
}
