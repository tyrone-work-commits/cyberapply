"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export type TourArea = 'explore'|'saved'|'applications'|'workspace'|'activity'|'account';
type Step={area:TourArea;title:string;description:string;target:string;mobileTarget?:string;fallback?:string};
export const tourSteps:ReadonlyArray<Step>=[
 {area:'explore',title:'Find live jobs',description:'Search selected Greenhouse and Lever boards using role, location and remote filters. Manage sources to choose different employer boards. Next and Back only move this guide.',target:'.job-sources .source-search'},
 {area:'explore',title:'Explore a job card',description:'Open details to check the source and requirements. Swipe left to reject, up to save for later, or right to Apply.',target:'.swipe-card',fallback:'.swipe-stage'},
 {area:'explore',title:'Undo a choice',description:'Undo restores your latest reject, save or unsent Apply choice when one is available.',target:'.swipe-actions .undo-button'},
 {area:'saved',title:'Saved jobs',description:'Bookmarked roles appear here. Return to their original listings or decide what to do with them later.',target:'.sidebar nav button:nth-child(2)',mobileTarget:'.mobile-nav button:nth-child(2)'},
 {area:'applications',title:'Track applications',description:'See each Apply request, its source and selected CV. A request is not proof the employer received it; check the status and finish any action needed.',target:'.sidebar nav button:nth-child(3)',mobileTarget:'.mobile-nav button:nth-child(3)'},
 {area:'workspace',title:'Upload your CV',description:'Upload a searchable PDF, DOCX or TXT. CyberApply reads its text, prepares a readiness score and fills candidate details it can identify.',target:'.cv-upload-button'},
 {area:'workspace',title:'Review your CV score',description:'Read the score and recommendations for text readiness, structure and evidence. This is guidance, not an employer ATS score.',target:'.quality-panel .quality-score'},
 {area:'workspace',title:'Confirm candidate facts',description:'Check your name, email, location, links, skills, preferred roles and CV text. Correct and save them before relying on application materials.',target:'.profile-form .section-title'},
 {area:'activity',title:'Review activity',description:'See saved actions and earlier versions. You can export your records for your own review.',target:'.sidebar nav button:nth-child(5)',mobileTarget:'.mobile-nav button:nth-child(5)'},
 {area:'activity',title:'Open Settings',description:'The gear opens your account settings for profile changes, agent pairing, export, tutorial replay, sign-out and account deletion.',target:'.topbar a[aria-label="Settings"]'},
 {area:'account',title:'Replay this guide',description:'Replay this shorter tour whenever you want. Settings also holds your account controls. Choose Finish to return to Explore.',target:'.account-main .account-section:nth-of-type(2) a'},
];
type Box={top:number;left:number;width:number;height:number};
function visible(selector:string):HTMLElement|null{
 if(!selector)return null;
 for(const el of document.querySelectorAll<HTMLElement>(selector)){const r=el.getBoundingClientRect();if(r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden')return el;}
 return null;
}
export function GuidedTour({step,busy,error,onBack,onNext,onExit}:{step:number;busy:boolean;error:string;onBack:()=>void;onNext:()=>void;onExit:()=>void}){
 const current=tourSteps[step];
 const panel=useRef<HTMLElement>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const [box,setBox]=useState<Box|null>(null);
 const [popup,setPopup]=useState<{top:number;left:number;above:boolean}|null>(null);
 useEffect(()=>{
  let target:HTMLElement|null=null;let timer:ReturnType<typeof setTimeout>|undefined;
  const place=()=>{
   if(!target?.isConnected)return;
   const r=target.getBoundingClientRect(),pad=6,width=Math.min(360,window.innerWidth-24),height=250;
   setBox({top:Math.max(5,r.top-pad),left:Math.max(5,r.left-pad),width:Math.min(window.innerWidth-10,r.width+pad*2),height:r.height+pad*2});
   const below=window.innerHeight-r.bottom>=height+18;
   setPopup({top:below?Math.min(window.innerHeight-height-12,r.bottom+18):Math.max(12,r.top-height-18),left:Math.max(12,Math.min(window.innerWidth-width-12,r.left+r.width/2-width/2)),above:!below});
  };
  const find=()=>{
   const mobile=window.matchMedia('(max-width: 950px)').matches;
   target=visible(mobile&&current.mobileTarget?current.mobileTarget:current.target)||visible(current.fallback||'')||visible('.page-heading');
   if(!target)return;
   const r=target.getBoundingClientRect();
   if(r.top<70||r.bottom>window.innerHeight-80){target.scrollIntoView({block:'center',behavior:'smooth'});timer=setTimeout(place,420);}
   place();
  };
  setBox(null);setPopup(null);
  const frame=requestAnimationFrame(find);
  window.addEventListener('resize',find);window.addEventListener('scroll',place,true);
  return()=>{cancelAnimationFrame(frame);clearTimeout(timer);window.removeEventListener('resize',find);window.removeEventListener('scroll',place,true);};
 },[step,current]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[step]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Tab'){
    const controls=[...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')||[])];
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&(document.activeElement===first||!panel.current?.contains(document.activeElement))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||!panel.current?.contains(document.activeElement))){e.preventDefault();first.focus();}
    return;
   }
   if(busy)return;
   if(e.key==='Escape'){e.preventDefault();onExit();}
   else if(e.key==='ArrowRight'){e.preventDefault();onNext();}
   else if(e.key==='ArrowLeft'&&step>0){e.preventDefault();onBack();}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[busy,onBack,onNext,onExit,step]);
 return <div className="guided-tour-layer" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description">
  <div className="tour-shield" aria-hidden="true"/>
  {box&&<><div className="tour-spotlight" style={box} aria-hidden="true"/><span className="tour-pointer" style={{top:box.top+Math.min(box.height/2,28),left:box.left+Math.min(box.width/2,28)}} aria-hidden="true"/></>}
  <section ref={panel} className={'guided-tour'+(popup?.above?' tour-above':'')} style={popup?{top:popup.top,left:popup.left}:undefined}>
   <div className="tour-top"><span className="tour-counter">CYBERAPPLY GUIDE · {step+1} OF {tourSteps.length}</span><button type="button" className="tour-close" aria-label="Skip tutorial" title="Skip tutorial" disabled={busy} onClick={onExit}><X size={18}/></button></div>
   <div className="tour-progress" role="progressbar" aria-valuemin={1} aria-valuemax={tourSteps.length} aria-valuenow={step+1}><span style={{width:((step+1)/tourSteps.length*100)+'%'}}/></div>
   <h2 id="tour-title" ref={heading} tabIndex={-1}>{current.title}</h2><p id="tour-description" className="tour-description">{current.description}</p>
   {error&&<p className="tour-error" role="alert">{error}</p>}
   <div className="tour-actions"><button type="button" className="tour-skip" disabled={busy} onClick={onExit}>Skip tour</button><div><button type="button" className="button quiet" disabled={busy||step===0} onClick={onBack}><ArrowLeft size={15}/>Back</button><button type="button" className="button" disabled={busy} onClick={onNext}>{busy?'Saving…':step===tourSteps.length-1?'Finish':'Next'}{!busy&&<ArrowRight size={15}/>}</button></div></div>
  </section>
 </div>;
}
