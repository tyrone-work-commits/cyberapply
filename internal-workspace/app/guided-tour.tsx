"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export type TourArea = 'explore'|'saved'|'applications'|'inbox'|'workspace'|'activity'|'account';
const areaLabel:Record<TourArea,string>={explore:'Explore',saved:'Saved',applications:'Applications',inbox:'Inbox',workspace:'CV review',activity:'Activity',account:'Settings'};
type Step={area:TourArea;title:string;description:string;target:string;mobileTarget?:string;fallback?:string};
export const tourSteps:ReadonlyArray<Step>=[
 {area:'explore',title:'Explore: find your next role',description:'Explore shows cybersecurity vacancies from your chosen employer boards. Review each role here before deciding. This guide only points to controls; it does not change jobs.',target:'.page-heading'},
 {area:'explore',title:'Search live openings',description:'Choose a role, location and remote filter, then search Greenhouse and Lever boards. Manage sources to change the employer boards you search.',target:'.job-sources .source-search'},
 {area:'explore',title:'Review and decide',description:'Read the card and original source. Swipe left to reject, up to save, or right to Apply. Undo restores the latest choice. Apply alone is not proof of employer submission.',target:'.swipe-actions',fallback:'.swipe-stage'},
 {area:'saved',title:'Saved: revisit roles',description:'Saved keeps jobs you bookmarked so you can compare them later. Saving a role does not apply for it.',target:'.page-heading'},
 {area:'saved',title:'Use saved job actions',description:'Open a role and its original listing, remove the bookmark, or choose Apply when ready. If this page is empty, save a card in Explore first.',target:'.list-grid .listing-row .row-actions',fallback:'.list-grid .empty-state'},
 {area:'applications',title:'Applications: track requests',description:'Applications tracks the roles you chose to Apply for, where each vacancy came from and what still needs attention.',target:'.page-heading'},
 {area:'applications',title:'Check submission status',description:'Review the source link, chosen CV, draft and status. A saved Apply request is not sent; only an employer confirmation means Applied. Open the original vacancy if action is needed.',target:'.application-overview-card',fallback:'.application-overview'},
 {area:'inbox',title:'Inbox: see application mail',description:'Inbox shows recent Gmail messages related to jobs in your Applications list. The connected Gmail address must match your CyberApply sign-in.',target:'.inbox-page .inbox-intro'},
 {area:'inbox',title:'Refresh and open messages',description:'Use Refresh to check again, then open a related message in Gmail. Other mail stays hidden here, and no message contents are stored in CyberApply.',target:'.inbox-page .inbox-intro button',fallback:'.inbox-page'},
 {area:'workspace',title:'CV review: improve your CV',description:'CV review reads your uploaded file, explains its text readiness and helps you verify candidate details before using them in applications.',target:'.page-heading'},
 {area:'workspace',title:'Upload and assess',description:'Upload a searchable PDF, DOCX or TXT file. The page gives a score out of 100 and recommendations; this is guidance, not an employer ATS decision.',target:'.cv-upload-button'},
 {area:'workspace',title:'Confirm candidate facts',description:'Check your name, email, links, location, skills and preferred roles. Correct anything missed, confirm accuracy and save. Your chosen CV is used for new Apply requests.',target:'.profile-form .section-title'},
 {area:'activity',title:'Activity: see what changed',description:'Activity records actions and earlier saved versions, so you can review what happened in the workspace and show evidence of your work.',target:'.page-heading'},
 {area:'activity',title:'Review history and export',description:'View recent actions and earlier versions below. Export evidence to download your workspace records for your own review.',target:'.evidence-strip > a',fallback:'.activity-grid'},
 {area:'account',title:'Settings: manage your account',description:'Settings holds your profile and account controls. You can export records, replay this guide, sign out or delete your CyberApply data.',target:'.account-main .account-intro'},
 {area:'account',title:'Replay or change settings',description:'Replay this tour whenever you need help. No automatic application agent is connected. Choose Finish to return to Explore.',target:'.account-main .account-section:nth-of-type(2) a'},
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
   <div className="tour-top"><span className="tour-counter">{areaLabel[current.area].toUpperCase()} · GUIDE {step+1} OF {tourSteps.length}</span><button type="button" className="tour-close" aria-label="Skip tutorial" title="Skip tutorial" disabled={busy} onClick={onExit}><X size={18}/></button></div>
   <div className="tour-progress" role="progressbar" aria-valuemin={1} aria-valuemax={tourSteps.length} aria-valuenow={step+1}><span style={{width:((step+1)/tourSteps.length*100)+'%'}}/></div>
   <h2 id="tour-title" ref={heading} tabIndex={-1}>{current.title}</h2><p id="tour-description" className="tour-description">{current.description}</p>
   {error&&<p className="tour-error" role="alert">{error}</p>}
   <div className="tour-actions"><button type="button" className="tour-skip" disabled={busy} onClick={onExit}>Skip tour</button><div><button type="button" className="button quiet" disabled={busy||step===0} onClick={onBack}><ArrowLeft size={15}/>Back</button><button type="button" className="button" disabled={busy} onClick={onNext}>{busy?'Saving…':step===tourSteps.length-1?'Finish':'Next'}{!busy&&<ArrowRight size={15}/>}</button></div></div>
  </section>
 </div>;
}
