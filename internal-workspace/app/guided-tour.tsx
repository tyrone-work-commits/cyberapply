"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export type TourArea = 'explore'|'saved'|'applications'|'workspace'|'activity';
type Step={area:TourArea;title:string;description:string;target:string;mobileTarget?:string;fallback?:string};
export const tourSteps:ReadonlyArray<Step>=[
 {area:'explore',title:'Welcome to CyberApply',description:'The logo takes you back to Explore. Follow the moving dot. Next and Back only move this guide; they will not change jobs or send applications.',target:'.sidebar .brand',mobileTarget:'.mobile-brand'},
 {area:'explore',title:'Choose a role',description:'Enter a role or skill such as cybersecurity, SOC analyst or security engineer. Leave it blank for a broader search.',target:'.job-sources .source-filters label:nth-child(1) input'},
 {area:'explore',title:'Choose a location',description:'Filter by city, country or region, or leave this blank for more results.',target:'.job-sources .source-filters label:nth-child(2) input'},
 {area:'explore',title:'Remote only',description:'Turn this on to narrow the results. Remote jobs can still have country or work-authorization restrictions.',target:'.job-sources .source-remote'},
 {area:'explore',title:'Find live jobs',description:'Search selected Greenhouse and Lever employer boards. Results keep their source links. Previous results remain saved during the search cooldown.',target:'.job-sources .source-search'},
 {area:'explore',title:'Manage job sources',description:'Open this list to review, add or remove employer boards. Your chosen sources and filters save when you search.',target:'.job-sources .source-manager summary'},
 {area:'explore',title:'Add a listing',description:'Save a real employer vacancy with its original URL and description. A listing you add is labelled as user-supplied.',target:'.page-heading > button'},
 {area:'explore',title:'Explore a job card',description:'Swipe left to reject, right to record Apply, or up to save for later. With a focused card, the arrow keys do the same.',target:'.swipe-card',fallback:'.swipe-stage'},
 {area:'explore',title:'Read the details',description:'Open a role to see its source, description and skill-keyword comparison. This is guidance, not an employer assessment.',target:'.swipe-card .listing-foot button',fallback:'.swipe-stage'},
 {area:'explore',title:'Save for later',description:'Tap the bookmark or swipe up. The job moves to Saved and the next card appears.',target:'.swipe-card .job-card-top button',fallback:'.swipe-actions'},
 {area:'explore',title:'Reject',description:'Tap Reject or swipe left to pass and see the next job.',target:'.swipe-actions .pass-button'},
 {area:'explore',title:'Undo',description:'Undo restores your latest reject, save or Apply choice when one is available.',target:'.swipe-actions .undo-button'},
 {area:'explore',title:'Apply',description:'Tap Apply or swipe right. Your request appears in Applications while you stay in Explore. It is not sent to an employer.',target:'.swipe-actions .apply-button'},
 {area:'saved',title:'Open Saved',description:'Use Saved to return to roles you bookmarked.',target:'.sidebar nav button:nth-child(2)',mobileTarget:'.mobile-nav button:nth-child(2)'},
 {area:'saved',title:'Saved jobs',description:'Bookmarked jobs appear here. Open, remove or choose Apply later. An empty page means you have not saved a job yet.',target:'.list-grid .listing-row',fallback:'.list-grid .empty-state'},
 {area:'applications',title:'Open Applications',description:'Use Applications to see every Apply request and what still needs action.',target:'.sidebar nav button:nth-child(3)',mobileTarget:'.mobile-nav button:nth-child(3)'},
 {area:'applications',title:'Connection status',description:'Automatic employer submission is not connected. This notice explains why an Apply request has not reached an employer.',target:'.connection-banner'},
 {area:'applications',title:'Apply requests',description:'See each Apply choice, its status and vacancy source. A saved request is not proof of submission.',target:'.application-overview-card',fallback:'.application-overview'},
 {area:'applications',title:'Original vacancy',description:'Open the employer link from an Apply request to complete the application manually. The link appears after you choose Apply.',target:'.application-overview-actions',fallback:'.application-overview'},
 {area:'applications',title:'Application materials',description:'When a draft exists, edit and save its text, confirm what you reviewed and open the employer application page.',target:'.draft-card',fallback:'.application-overview'},
 {area:'workspace',title:'Open CV review',description:'Use CV review to upload files, see recommendations and correct candidate facts.',target:'.sidebar nav button:nth-child(4)',mobileTarget:'.mobile-nav button:nth-child(4)'},
 {area:'workspace',title:'Upload your CV',description:'Upload a searchable PDF, DOCX or TXT file. CyberApply reads it, scores its text and fills candidate details it can identify.',target:'.cv-upload-button'},
 {area:'workspace',title:'CV readiness score',description:'The score and recommendations cover readable text, structure and evidence. This is guidance, not an employer ATS score.',target:'.quality-panel .quality-score'},
 {area:'workspace',title:'Understand the score',description:'Expand the checks to see evidence and suggestions. You can recheck the saved CV after updating it.',target:'.quality-panel .quality-breakdown',fallback:'.quality-panel'},
 {area:'workspace',title:'Candidate facts',description:'These details come from your CV when recognized. Cross-check them before using application materials.',target:'.profile-form .section-title'},
 {area:'workspace',title:'Name and email',description:'Confirm your full name and email and correct anything the CV reader missed.',target:'.profile-form .form-pair'},
 {area:'workspace',title:'Links and location',description:'Add your location, GitHub repository, LinkedIn link and portfolio website when relevant.',target:'.profile-form input[placeholder^="https://github.com"]',fallback:'.profile-form'},
 {area:'workspace',title:'Skills and preferred roles',description:'List your genuine skills and roles you want. Separate items with commas to help with job comparisons.',target:'.profile-form label:has(input[placeholder^="For example: SIEM"])',fallback:'.profile-form'},
 {area:'workspace',title:'Review and save facts',description:'Read the résumé text, tick the accuracy confirmation and save. Changed facts may require reviewing saved drafts again.',target:'.profile-form .form-foot button'},
 {area:'workspace',title:'Saved CV files',description:'View, download or delete an uploaded original here. Deleting a file keeps its extracted text, review and history.',target:'.saved-cv-files'},
 {area:'activity',title:'Open Activity',description:'Use Activity to see a record of actions, revisions and exportable evidence.',target:'.sidebar nav button:nth-child(5)',mobileTarget:'.mobile-nav button:nth-child(5)'},
 {area:'activity',title:'Recent actions',description:'See changes made in the interface and by a connected agent.',target:'.activity-grid > section:first-child'},
 {area:'activity',title:'Earlier versions',description:'Open a saved version to inspect facts and drafts without replacing your current work.',target:'.activity-grid > section:last-child'},
 {area:'activity',title:'Export records',description:'Download a copy of your workspace records for your own review and check-in evidence.',target:'.evidence-strip > a'},
 {area:'explore',title:'Work with your agent',description:'On desktop, this opens guidance for using your private workspace through ChatGPT. Agent actions also appear in Activity.',target:'.agent-entry',mobileTarget:'.topbar .header-actions'},
 {area:'explore',title:'Settings',description:'The gear opens Settings. Edit your profile, export records, replay the guide, sign out or delete your account there. Choose Finish to start using the app.',target:'.topbar a[aria-label="Settings"]'},
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
