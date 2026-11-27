"use client";
import {useEffect,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import './employer-multi-select.css';
export function EmployerMultiSelect({id,question,options,selected,disabled=false,invalid=false,describedBy,onChange}:{id:string;question:string;options:string[];selected:string[];disabled?:boolean;invalid?:boolean;describedBy?:string;onChange:(values:string[])=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 useEffect(()=>{const another=(event:Event)=>{if((event as CustomEvent<string>).detail!==id)setOpen(false);};document.addEventListener('cyberapply-employer-menu-open',another);return()=>document.removeEventListener('cyberapply-employer-menu-open',another);},[id]);
 const openMenu=()=>{document.dispatchEvent(new CustomEvent('cyberapply-employer-menu-open',{detail:id}));setOpen(true);};
 const expanded=open&&!disabled;
 const close=()=>{setOpen(false);trigger.current?.focus();};
 return <div className="employer-multi-select" ref={root} onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}}} onBlurCapture={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <div className="employer-multi-control"><button type="button" ref={trigger} id={id} className="employer-multi-trigger" aria-label={question} aria-expanded={expanded} aria-controls={id+'-choices'} aria-describedby={describedBy} aria-invalid={invalid||undefined} disabled={disabled||!options.length} onClick={()=>expanded?setOpen(false):openMenu()} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();openMenu();requestAnimationFrame(()=>root.current?.querySelector('input')?.focus());}}}>
   <span className="employer-multi-value">{selected.length===1?selected[0]:selected.length?`${selected.length} selected`:'Choose options'}</span><ChevronDown size={17} aria-hidden="true"/>
  </button>
  {expanded&&<div className="employer-multi-menu" id={id+'-choices'}><fieldset aria-label={question} disabled={disabled}><legend className="sr-only">Choose all options that apply</legend>{options.map((option,index)=><label className="employer-multi-option" key={index}><input type="checkbox" checked={selected.includes(option)} onChange={event=>{const next=new Set(selected);if(event.target.checked)next.add(option);else next.delete(option);onChange(options.filter(value=>next.has(value)));}}/><span>{option}</span></label>)}</fieldset><button type="button" className="button quiet employer-multi-done" onClick={close}>Done</button></div>}
  </div><span className="label-hint">Choose all options that apply. {selected.length?`Selected: ${selected.join('; ')}.`:'No options selected.'}</span>
 </div>;
}
