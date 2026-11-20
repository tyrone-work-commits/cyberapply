"use client";
import {cloneElement,useId,useLayoutEffect,useRef,useState,type ReactElement} from 'react';
import {createPortal} from 'react-dom';
import './icon-tip.css';

/** Shared only by signed-in tools. Never changes the wrapped action or its ref. */
export function IconTip({text,children}:{text:string;children:ReactElement<{title?:string;'aria-describedby'?:string}>}){
 const id=useId(),anchor=useRef<HTMLSpanElement>(null),tip=useRef<HTMLSpanElement>(null),delay=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [open,setOpen]=useState(false),[position,setPosition]=useState<{left:number;top:number}|null>(null);
 const cancelDelay=()=>{clearTimeout(delay.current);delay.current=undefined;};
 function show(){cancelDelay();setOpen(true);}
 function leave(){cancelDelay();delay.current=setTimeout(()=>{if(!anchor.current?.contains(document.activeElement))setOpen(false);},120);}
 useLayoutEffect(()=>()=>cancelDelay(),[]);
 useLayoutEffect(()=>{
  if(!open)return;const element=tip.current;if(!element)return;
  // Native popovers enter the top layer, above modal dialogs and clipped cards.
  try{element.showPopover?.();}catch{}
  const place=()=>{const target=anchor.current?.firstElementChild;if(!target?.isConnected){setOpen(false);return;}const box=target.getBoundingClientRect(),bounds=element.getBoundingClientRect(),gap=8;const left=Math.max(gap,Math.min(box.right-bounds.width,innerWidth-bounds.width-gap)),below=box.bottom+gap;const top=below+bounds.height<=innerHeight-gap?below:Math.max(gap,box.top-bounds.height-gap);setPosition({left,top});};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){cancelDelay();setOpen(false);event.preventDefault();event.stopPropagation();}};
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);window.addEventListener('keydown',escape,true);
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.removeEventListener('keydown',escape,true);try{element.hidePopover?.();}catch{}};
 },[open,text]);
 return <span className="icon-tip" ref={anchor} onPointerEnter={show} onPointerLeave={leave} onFocusCapture={show} onBlurCapture={leave}>{cloneElement(children,{'aria-describedby':[children.props['aria-describedby'],open?id:undefined].filter(Boolean).join(' ')||undefined,title:undefined})}{open&&createPortal(<span ref={tip} id={id} role="tooltip" popover="manual" className="icon-tooltip" style={{left:position?.left||0,top:position?.top||0,visibility:position?'visible':'hidden'}} onPointerEnter={show} onPointerLeave={leave}>{text}</span>,anchor.current?.closest('dialog,[role="dialog"]')||document.body)}</span>;
}
