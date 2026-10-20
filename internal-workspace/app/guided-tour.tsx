"use client";

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';

export type TourArea = 'explore' | 'saved' | 'applications' | 'workspace' | 'activity';

export const tourSteps: ReadonlyArray<{area:TourArea;label:string;title:string;description:string;points:ReadonlyArray<string>}> = [
  {
    area:'explore', label:'Welcome', title:'Find your way around CyberApply',
    description:'This short tour shows you how to find roles, improve your CV and track your next steps. It will not change your jobs or send an application.',
    points:['Your workspace is private to your ChatGPT identity.','You can skip now and replay the tour later from Settings.'],
  },
  {
    area:'explore', label:'Explore', title:'Find real cybersecurity roles',
    description:'Use the keyword, location and employer-board controls to search published Greenhouse and Lever vacancies. Open a card to read the role and its original source.',
    points:['Search results depend on the boards and filters you choose.','Searching does not send your CV to an employer.'],
  },
  {
    area:'explore', label:'Explore', title:'Choose what happens to a card',
    description:'Swipe left or tap Reject to pass. Swipe up or tap the bookmark to save for later. Swipe right or tap Apply to record your interest and move to the next card.',
    points:['Undo restores your latest choice.','Apply adds an unsent request to Applications; it does not submit to the employer.'],
  },
  {
    area:'saved', label:'Saved', title:'Come back to promising roles',
    description:'Jobs you save appear here. Read them again, remove them from Saved or choose Apply when you are ready.',
    points:['Saved jobs stay in your private workspace.','A saved job is not an application.'],
  },
  {
    area:'applications', label:'Applications', title:'Track every Apply request',
    description:'This page keeps your Apply choices, the vacancy source and your application materials together. Open the original employer page when you are ready to submit there.',
    points:['A request marked “Needs action” has not been sent.','Automatic employer submission needs a separately approved connection.'],
  },
  {
    area:'workspace', label:'CV review', title:'Review your CV and candidate facts',
    description:'Upload a CV to get a readiness score and practical suggestions. CyberApply fills candidate facts it can identify; check and correct them before using application materials.',
    points:['The score is guidance, not an employer ATS result.','You can view, download or delete your saved CV files.'],
  },
  {
    area:'activity', label:'Activity', title:'See what changed',
    description:'Activity shows recent actions and earlier saved versions. You can inspect a past version without replacing your current workspace.',
    points:['Your interface and connected agent actions share this record.','Export your records when you need your own copy.'],
  },
  {
    area:'explore', label:'Settings', title:'Manage your account',
    description:'The gear in the top-right corner opens Settings. There you can edit your account profile, export records, replay this tutorial, sign out or delete your CyberApply account.',
    points:['You are ready to explore at your own pace.'],
  },
];

export function GuidedTour({step,busy,error,onBack,onNext,onExit}:{step:number;busy:boolean;error:string;onBack:()=>void;onNext:()=>void;onExit:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const current=tourSteps[step];
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>{if(node?.open)node.close();};},[]);
  useEffect(()=>{heading.current?.focus();},[step]);
  return <dialog ref={dialog} className="guided-tour" aria-labelledby="tour-title" aria-describedby="tour-description" onCancel={event=>{event.preventDefault();if(!busy)onExit();}}>
    <div className="tour-top"><span className="tour-mark"><Compass size={20}/></span><span className="tour-counter">CYBERAPPLY GUIDE · {step+1} OF {tourSteps.length}</span><button type="button" className="tour-close" aria-label="Skip tutorial" title="Skip tutorial" disabled={busy} onClick={onExit}><X size={18}/></button></div>
    <div className="tour-progress" aria-label={`Step ${step+1} of ${tourSteps.length}`}>{tourSteps.map((item,index)=><span key={`${item.label}-${index}`} className={index<=step?'filled':''}/>)}</div>
    <span className="eyebrow">{current.label}</span>
    <h2 id="tour-title" ref={heading} tabIndex={-1}>{current.title}</h2>
    <p id="tour-description" className="tour-description">{current.description}</p>
    <ul className="tour-points">{current.points.map(point=><li key={point}><Check size={15}/><span>{point}</span></li>)}</ul>
    {error&&<p className="tour-error" role="alert">{error}</p>}
    <div className="tour-actions"><button type="button" className="tour-skip" disabled={busy} onClick={onExit}>Skip tutorial</button><div><button type="button" className="button quiet" disabled={busy||step===0} onClick={onBack}><ArrowLeft size={15}/>Back</button><button type="button" className="button" disabled={busy} onClick={onNext}>{busy?'Saving…':step===tourSteps.length-1?'Finish tour':'Next'}{!busy&&<ArrowRight size={15}/>}</button></div></div>
  </dialog>;
}
