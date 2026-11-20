'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {horizontalSwipeDirection} from '@/lib/swipe-gesture';

/** Horizontal decisions only: touch scrolling and the card's controls keep their normal behavior. */
export default function SwipeVacancy({jobId,disabled,onDecide,children}:{jobId:string;disabled:boolean;onDecide:(decision:'pass'|'apply')=>Promise<void>;children:ReactNode}){
 const [drag,setDrag]=useState(0),[dragging,setDragging]=useState(false);
 const start=useRef<{x:number;y:number;pointerId:number;jobId:string}|null>(null),frame=useRef<number|null>(null),offset=useRef(0),committing=useRef(false);
 function cancel(){start.current=null;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;offset.current=0;setDrag(0);setDragging(false);}
 useEffect(()=>{cancel();return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);};},[jobId,disabled]);
 async function decide(choice:'pass'|'apply'){if(disabled||committing.current)return;committing.current=true;try{await onDecide(choice);}finally{committing.current=false;}}
 const direction=horizontalSwipeDirection(drag,0,10);
 return <><p className="search-swipe-hint">Swipe left to reject · Swipe right to Apply. You can also use the buttons below.</p><div className="search-swipe-viewport"><div className={'search-swipe-card'+(dragging?' is-dragging':'')} role="group" tabIndex={0} aria-label="Swipe this vacancy left to reject or right to apply" aria-keyshortcuts="ArrowLeft ArrowRight" aria-disabled={disabled} style={{transform:`translate3d(${drag}px,0,0)`}}
 onPointerDown={event=>{if(disabled||committing.current||!event.isPrimary||event.button!==0||(event.target as HTMLElement).closest('button,a,input,textarea,select,summary,label,[contenteditable],[role="button"],[role="combobox"]'))return;start.current={x:event.clientX,y:event.clientY,pointerId:event.pointerId,jobId};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);}}
 onPointerMove={event=>{const began=start.current;if(!began||disabled||event.pointerId!==began.pointerId)return;const dx=event.clientX-began.x,dy=event.clientY-began.y;offset.current=horizontalSwipeDirection(dx,dy,10)?Math.max(-100,Math.min(100,dx)):0;if(frame.current===null)frame.current=requestAnimationFrame(()=>{frame.current=null;setDrag(offset.current);});}}
 onPointerUp={event=>{const began=start.current;if(!began||event.pointerId!==began.pointerId)return;cancel();if(disabled||began.jobId!==jobId)return;const choice=horizontalSwipeDirection(event.clientX-began.x,event.clientY-began.y);if(choice)void decide(choice);}}
 onPointerCancel={cancel} onLostPointerCapture={cancel}
 onKeyDown={event=>{if(event.target!==event.currentTarget||event.repeat||disabled)return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();void decide(event.key==='ArrowRight'?'apply':'pass');}}}>
 {direction&&<span aria-hidden="true" className={'search-swipe-label '+(direction==='apply'?'accept':'pass')}>{direction==='apply'?'APPLY':'REJECT'}</span>}{children}</div></div></>;
}
