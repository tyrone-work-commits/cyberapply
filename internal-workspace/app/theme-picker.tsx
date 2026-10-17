"use client";
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Palette, X } from 'lucide-react';
import { themeChoices } from '@/lib/theme-preference';
import { useTheme } from './theme-provider';

export default function ThemePicker(){
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null);
 const {theme,chooseTheme}=useTheme();
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>previous?.focus?.();},[open]);
 return <><button type="button" className="button quiet theme-trigger" aria-label="Choose theme" aria-haspopup="dialog" onClick={()=>setOpen(true)}><Palette size={18}/><span>Theme</span></button>{open&&<dialog ref={dialog} className="modal" aria-labelledby="theme-picker-title" onCancel={event=>{event.preventDefault();setOpen(false);}}><div className="modal-head"><h2 id="theme-picker-title">Choose your theme</h2><button type="button" className="button icon-button quiet" aria-label="Close theme chooser" onClick={()=>setOpen(false)}><X size={19}/></button></div><p className="subtle">Make CyberApply feel like yours. Your choice follows you through sign-in, profile setup and your workspaces on this browser.</p><div className="theme-grid">{themeChoices.map(([value,label])=><button type="button" aria-pressed={theme===value} className={theme===value?'theme-choice selected':'theme-choice'} key={value} onClick={()=>chooseTheme(value)}><span className={`theme-swatch swatch-${value}`}><i/><i/><i/></span><strong>{label}</strong>{theme===value&&<CheckCircle2 size={18}/>}</button>)}</div></dialog>}</>;
}
