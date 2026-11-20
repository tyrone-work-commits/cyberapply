"use client";
import {IconTip} from "./icon-tip";
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export type TourArea = 'search'|'explore'|'saved'|'applications'|'workspace'|'activity'|'account';
const areaLabel:Record<TourArea,string>={search:'Search',explore:'Explore',saved:'Saved',applications:'Applications',workspace:'CV review',activity:'Activity',account:'Settings'};
type Step={area:TourArea;title:string;description:string;target:string;mobileTarget?:string;fallback?:string};
export const tourSteps:ReadonlyArray<Step>=[
 {area:'explore',title:'Explore: review available jobs',description:'Explore automatically shows available cybersecurity vacancies from your saved employer sources. The sliders open application settings and the Cards or Grid layout. The gear opens Account Settings. This tour only explains controls; it never applies, rejects or saves a job.',target:'button[aria-label="Explore settings"]'},
 {area:'explore',title:'Reject, undo, apply or save',description:'Read the vacancy and original source. Swipe left to reject, right to Apply, or up on the card header to save. The buttons below do the same; Undo is in the middle. Grid has job action buttons too. Apply creates a request and keeps you in Explore; it does not mean the employer received it.',target:'.swipe-actions, .explore-grid-decisions',fallback:'.explore-empty'},
 {area:'search',title:'Search: find a specific vacancy',description:'Search by role, company or industry. Suggested titles come from available vacancies in your collection. Type for suggestions, then choose one or press Search. Companies to follow appear on the starting screen; results have Jobs and Companies tabs.',target:'.reference-search-bar'},
 {area:'search',title:'Filter results and open a job',description:'Use location, Remote and search options to narrow results. Open a vacancy to read it in a popup, then swipe left to reject or right to Apply. Search options also hold Last Search and saved searches. Edit Profile manages employer boards and background refresh. Live refresh has a cooldown; saved results remain available.',target:'.reference-filter-chips, .reference-search-tools > summary',fallback:'.reference-search-bar'},
 {area:'saved',title:'Saved: keep roles for later',description:'Saved holds vacancies you bookmarked in Explore or Search. It lets you revisit the details and original source before deciding. Saving a job does not send an application.',target:'.page-heading'},
 {area:'saved',title:'Decide on a saved vacancy',description:'Swipe left or choose Pass to reject; swipe right or choose Apply to request an application. Either choice removes the vacancy from Saved. If this page is empty, bookmark a role in Explore first.',target:'.saved-swipe-item .row-actions',fallback:'.list-grid'},
 {area:'applications',title:'Applications: track each request',description:'Applications follows your Apply requests, agent progress and employer outcomes. Filter by status or search by role, company or source. Requested and Agent working are not confirmation. Applied requires recorded employer evidence; never retry an uncertain submission without checking first.',target:'.application-filters'},
 {area:'applications',title:'Answer questions and complete handoffs',description:'Answer employer questions using captured choices and your saved CV, profile or Answers library details. Save to continue. Complete human/AI checks yourself in the same agent browser, then return control. For Greenhouse/reCAPTCHA, press final Submit yourself only when Ready; leave that browser open.',target:'.application-question-answers',fallback:'.application-overview-card .application-next-step, .application-overview-empty'},
 {area:'applications',title:'Agent controls, source and recording',description:'These sliders hold your agent, next CV, receipt checking and Clear all applications. The gear opens Settings. Cards have an employer link, Watch live while the agent works, and Watch recording with a download option. The live viewer shows when your input is needed and lets you open the exact browser and return control. Live now has one buffered timeline: rewind, pause, Watch from beginning or Go live. Uploaded footage extends the same player after the agent resumes. New recordings include ordinary manual input, with private passwords/codes/CAPTCHA hidden. Video is not an employer receipt.',target:'button[aria-label="Applications settings"]'},
 {area:'workspace',title:'CV review: your files and feedback',description:'CV review keeps your uploaded CV files, quality scores and recommendations together. Upload a CV to review its quality, then manage your saved files and choose one for applications. Scores and suggestions are guidance; they do not guarantee an employer decision.',target:'.cv-review-sections'},
 {area:'workspace',title:'Upload and review your CV',description:'Upload a searchable PDF, DOCX or TXT file for a quality score out of 100 and recommendations. Review the feedback and check the original file. Use the recommendations to improve your document and recheck it when needed. The score is guidance, not an employer ATS decision.',target:'.cv-upload',fallback:'.cv-review-sections'},
 {area:'workspace',title:'Choose the CV for new applications',description:'Your saved CV files let you view, download, choose or delete a file. Choose the original CV you want the agent to use. New Apply requests keep that selected file; changing the selection does not silently replace a CV already attached to an existing request.',target:'#saved-cv-files'},
 {area:'activity',title:'Activity: review actions and evidence',description:'Activity records workspace actions and earlier saved versions. Open a version to inspect it without overwriting your current work, or export your records here. You can return to Activity from Account Settings, above Export my records.',target:'.evidence-strip > a',fallback:'.activity-grid'},
 {area:'account',title:'Settings: profile, answers and records',description:'The gear opens Account Settings. Edit account profile holds your contact details, location, salary and work permissions. This page also holds Answers library, Companies you follow, Activity and Export my records. Your records belong to your signed-in account.',target:'.account-main .account-intro'},
 {area:'account',title:'Keep profile facts and answers accurate',description:'Keep Edit account profile up to date. Answers library stores employer questions, dropdown choices and your editable answers for reuse when the question and choices match. The agent combines this information with your chosen CV. Missing personal facts are not invented, and human verification still needs you.',target:'#account-answers-button'},
 {area:'account',title:'Connect and check your application agent',description:'This section shows whether your background runner is connected and offers Open agent setup to reconnect it on your Windows computer. Keep that computer awake and online. A connection token alone does not prove the runner is working. The exact browser must stay open during a personal verification or final-submit handoff.',target:'#application-agent-heading'},
 {area:'account',title:'Help, replay and account controls',description:'Help contains Help centre, Privacy and Internal terms. Both notice pages link back to Account Settings. Replay tutorial is under App tutorial above. Below are local-cache reset, Sign out and account deletion with confirmation. Choose Finish to return to Explore; this guide has not submitted any job applications.',target:'.account-help-section'},
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
 const [popup,setPopup]=useState<{top:number;left:number;width:number;above:boolean}|null>(null);
 useEffect(()=>{
  let target:HTMLElement|null=null;let timer:ReturnType<typeof setTimeout>|undefined;
  const place=()=>{
   if(!target?.isConnected)return;
   const viewportWidth=document.documentElement.clientWidth||window.innerWidth,viewportHeight=document.documentElement.clientHeight||window.innerHeight;
   const r=target.getBoundingClientRect(),pad=6,width=Math.min(360,viewportWidth-24),height=panel.current?.getBoundingClientRect().height||250;
   const top=Math.max(5,r.top-pad),left=Math.max(5,r.left-pad);
   setBox({top,left,width:Math.max(0,Math.min(viewportWidth-5,r.right+pad)-left),height:Math.max(0,Math.min(viewportHeight-5,r.bottom+pad)-top)});
   const below=viewportHeight-r.bottom>=height+18;
   const preferredTop=below?r.bottom+18:r.top-height-18;
   setPopup({top:Math.max(12,Math.min(viewportHeight-height-12,preferredTop)),left:Math.max(12,Math.min(viewportWidth-width-12,r.left+r.width/2-width/2)),width,above:!below});
  };
  const pickTarget=()=>{const mobile=window.matchMedia('(max-width: 950px)').matches;return visible(mobile&&current.mobileTarget?current.mobileTarget:current.target)||visible(current.fallback||'')||visible('.page-heading');};
  const find=()=>{
   target=pickTarget();
   if(!target)return;
   const r=target.getBoundingClientRect();
   clearTimeout(timer);
   if(r.top<70||r.bottom>window.innerHeight-80){target.scrollIntoView({block:'center',behavior:'smooth'});timer=setTimeout(place,420);}
   place();
  };
  setBox(null);setPopup(null);
  const frame=requestAnimationFrame(find);
  const observer=new MutationObserver(()=>{if(pickTarget()!==target)find();});
  observer.observe(document.body,{childList:true,subtree:true});
  const panelObserver=new ResizeObserver(place);
  if(panel.current)panelObserver.observe(panel.current);
  window.addEventListener('resize',find);window.addEventListener('scroll',place,true);
  return()=>{cancelAnimationFrame(frame);clearTimeout(timer);observer.disconnect();panelObserver.disconnect();window.removeEventListener('resize',find);window.removeEventListener('scroll',place,true);};
 },[step,current]);
 useEffect(()=>{if(panel.current)panel.current.scrollTop=0;heading.current?.focus({preventScroll:true});},[step]);
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
  <section ref={panel} className={'guided-tour'+(popup?.above?' tour-above':'')} style={popup?{top:popup.top,left:popup.left,width:popup.width}:undefined}>
   <div className="tour-top"><span className="tour-counter">{areaLabel[current.area].toUpperCase()} · GUIDE {step+1} OF {tourSteps.length}</span><IconTip text="Skip the app tutorial"><button type="button" className="tour-close" aria-label="Skip tutorial" title="Skip tutorial" disabled={busy} onClick={onExit}><X size={18}/></button></IconTip></div>
   <div className="tour-progress" role="progressbar" aria-valuemin={1} aria-valuemax={tourSteps.length} aria-valuenow={step+1}><span style={{width:((step+1)/tourSteps.length*100)+'%'}}/></div>
   <h2 id="tour-title" ref={heading} tabIndex={-1}>{current.title}</h2><p id="tour-description" className="tour-description">{current.description}</p>
   {error&&<p className="tour-error" role="alert">{error}</p>}
   <div className="tour-actions"><button type="button" className="tour-skip" disabled={busy} onClick={onExit}>Skip tour</button><div><button type="button" className="button quiet" disabled={busy||step===0} onClick={onBack}><ArrowLeft size={15}/>Back</button><button type="button" className="button" disabled={busy} onClick={onNext}>{busy?'Saving…':step===tourSteps.length-1?'Finish':'Next'}{!busy&&<ArrowRight size={15}/>}</button></div></div>
  </section>
 </div>;
}
