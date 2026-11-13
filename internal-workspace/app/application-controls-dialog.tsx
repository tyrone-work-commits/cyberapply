'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import './application-controls.css';

/** Keep children mounted so automatic receipt checks also run while this dialog is closed. */
export function ApplicationControlsDialog({open,onClose,children}:{open:boolean;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  if(!open)return;
  const trigger=document.activeElement as HTMLElement|null,dialog=ref.current;
  dialog?.showModal();
  return()=>{dialog?.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};
 },[open]);
 return <dialog ref={ref} id="applications-controls-dialog" className="modal applications-controls-dialog" aria-labelledby="applications-controls-title" onCancel={event=>{event.preventDefault();onClose();}}>
  <div className="modal-head"><h2 id="applications-controls-title">Application settings</h2><button type="button" className="button icon-button quiet" aria-label="Close application settings" onClick={onClose}><X size={19}/></button></div>
  {children}
 </dialog>;
}
