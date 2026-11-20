"use client";
import {cloneElement,useId,useState,type ReactElement} from 'react';
import './explore-icon-tip.css';

/** Explanations for Explore's icon-only actions; ordinary buttons are unchanged. */
export function ExploreIconTip({text,children}:{text:string;children:ReactElement<{title?:string;'aria-describedby'?:string}>}){
 const id=useId(),[dismissed,setDismissed]=useState(false);
 return <span className="explore-icon-tip" data-dismissed={dismissed} onPointerEnter={()=>setDismissed(false)} onFocusCapture={()=>setDismissed(false)} onKeyDown={event=>{if(event.key==='Escape'){setDismissed(true);event.preventDefault();event.stopPropagation();}}}>{cloneElement(children,{'aria-describedby':[children.props['aria-describedby'],id].filter(Boolean).join(' '),title:undefined})}<span id={id} role="tooltip" className="explore-icon-tooltip">{text}</span></span>;
}
