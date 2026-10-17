"use client";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Undo2, X, LoaderCircle } from 'lucide-react';
import type { Job } from '@/lib/cyber-domain';
import { swipeDirection } from '@/lib/swipe-gesture';

type Offset={x:number;y:number};
export function SwipeDeck({job,children,empty,disabled,canUndo,pending,blocked,onDecide,onSave,onUndo}:{job:Job|undefined;children:ReactNode;empty:ReactNode;disabled:boolean;canUndo:boolean;pending:number;blocked:boolean;onDecide:(job:Job,decision:'pass'|'apply')=>void;onSave:(job:Job)=>void;onUndo:()=>void}){
 const [drag,setDrag]=useState<Offset>({x:0,y:0});
 const start=useRef<{x:number;y:number;id:string}|null>(null),frame=useRef<number|null>(null),offset=useRef<Offset>({x:0,y:0});
 function cancel(){start.current=null;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;offset.current={x:0,y:0};setDrag(offset.current);}
 useEffect(()=>{cancel();return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);};},[job?.id]);
 const direction=swipeDirection(drag.x,drag.y,0);
 return <><p className="save-swipe-hint">↑ Swipe up or tap the bookmark to save for later</p><div className="swipe-stage">{job?<div className="swipe-card" tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp" aria-label={`Job card: ${job.title}. Left arrow to reject, right arrow to apply, up arrow to save for later.`}
  style={{transform:`translate3d(${drag.x}px,${drag.y}px,0) rotate(${drag.x/28}deg)`}}
  onPointerDown={event=>{if(disabled||!event.isPrimary||event.button!==0||(event.target as HTMLElement).closest('button,a,input,textarea,select,summary'))return;start.current={x:event.clientX,y:event.clientY,id:job.id};event.currentTarget.setPointerCapture(event.pointerId);}}
  onPointerMove={event=>{if(!start.current||disabled)return;const dx=event.clientX-start.current.x,dy=event.clientY-start.current.y;const next=swipeDirection(dx,dy,10);offset.current=next==='save'?{x:0,y:Math.max(-140,dy)}:next?{x:Math.max(-140,Math.min(140,dx)),y:0}:{x:0,y:0};if(frame.current===null)frame.current=requestAnimationFrame(()=>{frame.current=null;setDrag(offset.current);});}}
  onPointerUp={event=>{const began=start.current;cancel();if(!began||disabled||began.id!==job.id)return;const choice=swipeDirection(event.clientX-began.x,event.clientY-began.y);if(choice==='save')onSave(job);else if(choice)onDecide(job,choice);}}
  onPointerCancel={cancel} onLostPointerCapture={cancel}
  onKeyDown={event=>{if(event.target!==event.currentTarget||disabled||event.repeat)return;if(event.key==='ArrowUp'){event.preventDefault();onSave(job);}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();onDecide(job,event.key==='ArrowRight'?'apply':'pass');}}}>
  {direction&&<span className={`swipe-label ${direction==='save'?'save':direction==='apply'?'accept':'pass'}`}>{direction==='save'?'SAVE FOR LATER':direction==='apply'?'APPLY':'REJECT'}</span>}{children}</div>:empty}</div>
  <div className="swipe-actions" aria-label="Job decisions"><button type="button" className="button decision pass-button" aria-label="Reject this job" disabled={disabled||!job} onClick={()=>job&&onDecide(job,'pass')}><X size={23}/><span>Reject</span></button><button type="button" className="button decision undo-button" aria-label="Undo last swipe" disabled={disabled||!canUndo} onClick={onUndo}><Undo2 size={22}/><span>Undo</span></button><button type="button" className="button decision apply-button" aria-label="Apply for this job" disabled={disabled||!job} onClick={()=>job&&onDecide(job,'apply')}><ArrowRight size={24}/><span>Apply</span></button></div>
  <div className="swipe-sync" role="status" aria-live="polite">{pending?<><LoaderCircle size={14} className="spin"/><span>Saving {pending===1?'your choice':`${pending} choices`}… You can keep swiping.</span></>:blocked?<span>Reload to confirm your saved choices.</span>:<span>Left: reject · Right: Apply · Up: save for later.<br/>Undo restores your latest choice.</span>}</div></>;
}
