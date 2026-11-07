"use client";
import {useState} from 'react';
import {Check} from 'lucide-react';
import type {ApplicationRequest} from '@/lib/cyber-domain';
import {employerQuestionKey,type EmployerQuestion} from '@/lib/employer-questions';
import {applicationQuestionChoices} from '@/lib/application-question-choices';
import {applicationFormQuestions,canEditApplicationQuestions} from '@/lib/application-form-questions';
import {isLocationMenu,employerChoiceLimit,locationCapture} from '@/lib/employer-location-choices';

export function ApplicationQuestionAnswers({application,busy,onSave,onRefreshChoices,onCaptureLocations,defaultCity,employerQuestions}:{application:ApplicationRequest;employerQuestions:EmployerQuestion[];busy:boolean;onRefreshChoices:()=>Promise<string>;onCaptureLocations:(cityQuery:string)=>Promise<string>;defaultCity:string;onSave:(answers:{question:string;value:string}[])=>Promise<boolean>}){
 const raw=applicationFormQuestions(application,employerQuestions),readOnly=!canEditApplicationQuestions(application);
 const questions=[...new Map(raw.filter(item=>item&&typeof item==='object'&&typeof (item as Record<string,unknown>).question==='string').map(item=>{
  const entry=item as Record<string,unknown>,question=String(entry.question).slice(0,4000);
  const recorded=Array.isArray(application.report?.answers)?application.report.answers.find(row=>row&&typeof row==='object'&&employerQuestionKey(String((row as Record<string,unknown>).question||''))===employerQuestionKey(question)) as Record<string,unknown>|undefined:undefined;
  return [question,{question,recordedAnswer:typeof recorded?.value==='string'?recorded.value.slice(0,20000):'',reason:typeof entry.reason==='string'?entry.reason:'',profile:entry.source==='edit_profile',generated:entry.source==='generated',suggestion:typeof entry.suggested_value==='string'?entry.suggested_value:'',evidence:typeof entry.evidence==='string'?entry.evidence:'',...applicationQuestionChoices(application,entry,employerQuestions)}] as const;
 })).values()].filter(item=>item.question.trim());
 const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries(questions.filter(item=>!item.profile).map(item=>[item.question,application.confirmedAnswers?.find(answer=>answer.question===item.question)?.value||item.suggestion])));
 const [confirmed,setConfirmed]=useState(false);
 const [refreshingChoices,setRefreshingChoices]=useState(false),[choiceMessage,setChoiceMessage]=useState('');
 const [cityQuery,setCityQuery]=useState(defaultCity),[capturingLocations,setCapturingLocations]=useState(false);
 const capture=locationCapture(application.report),locationPending=!!capture&&['queued','reading'].includes(capture.state)&&Date.parse(capture.expiresAt)>Date.now();
 const hasCity=questions.some(q=>isLocationMenu(q.question)&&/city|^location\s*\*?$/i.test(q.question));
 const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
 const answers=questions.filter(item=>!item.profile).map(item=>({question:item.question,value:(values[item.question]||'').trim()})).filter(item=>item.value);
 const invalidChoice=questions.some(item=>!item.profile&&item.isDropdown&&!!values[item.question]&&!item.options.includes(values[item.question]));
 const update=(question:string,value:string)=>{setValues({...values,[question]:value});setConfirmed(false);setSaved(false);};
 if(!questions.length)return null;
  return <form className="application-question-answers" onSubmit={async event=>{event.preventDefault();if(readOnly||busy||saving||!confirmed||!answers.length||invalidChoice)return;setSaving(true);try{if(await onSave(answers)){setSaved(true);setConfirmed(false);}}finally{setSaving(false);}}}>
  <h4>{questions.some(item=>item.generated)?'Generated answers need your approval':'Answer this employer’s questions'}</h4>
  <p className="subtle">{readOnly?"Captured employer questions are shown for reference. Answers are read-only in this application's current state.":"The dropdowns below use choices captured from this employer form, including menus the agent already answered. Change only answers you can confirm. Saving does not queue or submit an application."}</p>
  {!readOnly&&questions.some(item=>item.isDropdown)&&<div><button type="button" className="button quiet" disabled={busy||saving||refreshingChoices} onClick={async()=>{setRefreshingChoices(true);setChoiceMessage('');try{setChoiceMessage(await onRefreshChoices());}catch(error){setChoiceMessage(error instanceof Error?error.message:'Employer choices could not be refreshed.');}finally{setRefreshingChoices(false);}}}>{refreshingChoices?'Reading employer dropdowns…':'Refresh employer dropdowns'}</button><p className="subtle">Reads this vacancy’s current question choices. Your answers stay in place; this does not restart or submit the application.</p>{choiceMessage&&<p className="subtle" role="status">{choiceMessage}</p>}</div>}
  {!readOnly&&questions.some(item=>item.isDropdown&&isLocationMenu(item.question))&&<div className="location-choice-capture">
   {hasCity&&<label>City to search<input value={cityQuery} maxLength={120} disabled={busy||locationPending} onChange={event=>setCityQuery(event.target.value)} placeholder="Enter a city name"/><span className="label-hint">Sends only this city name to the employer's location lookup to read its suggestions.</span></label>}
   <button type="button" className="button quiet" disabled={busy||saving||capturingLocations||locationPending} onClick={async()=>{setCapturingLocations(true);setChoiceMessage('');try{setChoiceMessage(await onCaptureLocations(hasCity?cityQuery:''));}catch(error){setChoiceMessage(error instanceof Error?error.message:'The menu reader could not start.');}finally{setCapturingLocations(false);}}}>{locationPending?'Reading country/city menus...':'Capture country and city choices'}</button>
   <p className="subtle">Your background agent opens a blank employer form and reads these menus only. It does not upload your CV, fill other answers or submit an application.</p>
   {capture&&<p className="subtle" role="status">{['queued','reading'].includes(capture.state)&&!locationPending?'The menu capture expired. Reconnect the background agent if needed, then capture the choices again.':capture.state==='queued'?'Waiting for your background agent to read the menus.':capture.state==='reading'?"Reading the employer's country and city menus...":capture.message}</p>}
  </div>}
  {questions.map((item,index)=>{
   const inputId=`application-answer-${application.id}-${index}`,value=values[item.question]||'';
   const dropdown=<select id={inputId} value={value} disabled={readOnly||busy||saving||item.profile||!item.options.length} onChange={event=>update(item.question,event.target.value)}><option value="">{item.options.length?'Choose an option':'Employer choices not yet captured'}</option>{!!value&&!item.options.includes(value)&&<option value={value} disabled>Previous answer (review required): {value}</option>}{item.options.map((option,i)=><option key={i} value={option}>{option}</option>)}</select>;
   return item.profile&&!readOnly?<div key={item.question}><label htmlFor={item.isDropdown?inputId:undefined}><strong>{item.question}</strong>{item.isDropdown&&dropdown}</label><p className="subtle">{item.reason}</p><a className="button quiet" href="/onboarding?edit=1">Update Edit Profile</a></div>:<label key={item.question} htmlFor={inputId}>{item.question}{item.generated&&<span className="badge">AGENT DRAFT · REVIEW REQUIRED</span>}{item.isDropdown?dropdown:<textarea id={inputId} rows={item.generated?5:2} maxLength={20000} value={value} disabled={readOnly||busy||saving} onChange={event=>update(item.question,event.target.value)}/>}{item.recordedAnswer&&<span className="label-hint">Agent’s recorded answer: {item.recordedAnswer}</span>}{item.isDropdown&&!item.options.length&&<span className="label-hint">{isLocationMenu(item.question)?'Use Capture country and city choices above. Enter a city search first when needed.':'Use Refresh employer dropdowns above. Search-dependent menus are captured by the agent when the employer makes their choices available.'}</span>}{item.isDropdown&&!!value&&!item.options.includes(value)&&<span className="label-hint">Your previous answer is not in this employer’s choices. Select a current option before saving.</span>}{item.truncated&&<span className="label-hint">First {employerChoiceLimit(item.question)} captured choices shown. Check the employer website for any additional options.</span>}{item.reason&&<span className="label-hint">{item.reason}</span>}{item.generated&&item.evidence&&<span className="label-hint">Basis: {item.evidence}</span>}</label>;
  })}
  {!readOnly&&<>
  <p className="subtle">For a checkbox or consent question, enter “Yes” only if you personally agree to its exact wording above for this employer. Enter “No” to decline. The agent will not choose an opt-in for you.</p>
  <label className="check-label"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>I have reviewed these exact answers and approve the agent using them. I confirm that they are accurate. Any “Yes” I entered for a consent or checkbox question is my explicit choice for that exact question in this application.</span></label>
  <button type="submit" className="button quiet" disabled={busy||saving||!confirmed||!answers.length||invalidChoice}><Check size={16}/>{saving?'Saving approval…':'Approve and save answers'}</button>
  <p className="subtle" role="status">{saved?'Your answers are saved. Continue with my answers will use these exact responses.':'Update missing details in Edit Profile, or save the other answers above. Then queue the agent again.'}</p>
  </>}
 </form>;
}
