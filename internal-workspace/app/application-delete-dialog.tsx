"use client";
import {useEffect,useRef,useState} from 'react';
import {Trash2,X} from 'lucide-react';
import type {DeletionScope} from '@/lib/application-deletion';
export type DeleteTarget={scope:DeletionScope;applicationId?:string;label:string};
export function ApplicationDeleteDialog({target,busy,onCancel,onDelete}:{target:DeleteTarget;busy:boolean;onCancel:()=>void;onDelete:(target:DeleteTarget,legacy:boolean)=>Promise<boolean>}){
 const ref=useRef<HTMLDialogElement>(null),[confirmation,setConfirmation]=useState(''),[legacy,setLegacy]=useState(false),[failure,setFailure]=useState('');
 useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.showModal();return()=>previous?.focus?.();},[]);
 return <dialog className="modal application-delete-dialog" ref={ref} aria-labelledby="delete-application-title" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}><div className="modal-head"><h2 id="delete-application-title">Permanently delete {target.scope==='candidate_facts'?'old Candidate Facts':target.scope==='cleared'?'cleared applications':'this application'}?</h2><button className="button icon-button quiet" disabled={busy} aria-label="Close delete dialog" onClick={onCancel}><X size={18}/></button></div>
 <p><strong>{target.label}</strong></p><p>This removes the selected records and their copies in saved workspace history. There is no restore or undo. Original CV files, CV review scores, Edit Profile and the agent connection stay saved.</p>
 {target.scope==='cleared'&&<label className="check-label"><input type="checkbox" checked={legacy} disabled={busy} onChange={e=>setLegacy(e.target.checked)}/><span>Also permanently remove old Candidate Facts and manual review data. The app will still read my chosen CV for CV review and applications.</span></label>}
 <p className="subtle">This does not withdraw an application from an employer. A minimal vacancy identifier is retained for a submitted or uncertain application to prevent an accidental duplicate; its answers, CV snapshot, report and draft are removed.</p>
 <label htmlFor="permanent-application-confirmation">Type PERMANENTLY DELETE to confirm<input id="permanent-application-confirmation" value={confirmation} disabled={busy} autoComplete="off" onChange={e=>setConfirmation(e.target.value)}/></label>
 {failure&&<p className="inline-error" role="alert">{failure}</p>}
 <div className="form-foot"><button className="button quiet" disabled={busy} onClick={onCancel}>Cancel</button><button className="button danger" disabled={busy||confirmation!=='PERMANENTLY DELETE'} onClick={()=>void onDelete(target,legacy).then(saved=>{if(saved)onCancel();else setFailure('Deletion could not be confirmed. Close this dialog and reload your saved records before trying again.');})}><Trash2 size={16}/>{busy?'Deleting…':'Permanently delete'}</button></div></dialog>;
}
