"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {RefreshCw,TriangleAlert} from 'lucide-react';
import type {ApplicationRequest} from '@/lib/cyber-domain';
import {recoveryGate,type RecoverySnapshot} from '@/lib/application-browser-recovery';
import {ApplicationManualSubmit} from './application-manual-submit';
import './application-session-recovery.css';

export function useApplicationSessionRecovery(applications:ApplicationRequest[]){
 const expectsBrowser=applications.some(item=>item.status==='processing'||item.manualSubmission?.state==='closed_before_submit');
 const [snapshot,setSnapshot]=useState<RecoverySnapshot|null>(null),[failed,setFailed]=useState(false),[checkedSignature,setCheckedSignature]=useState(''),[checking,setChecking]=useState(false),[open,setOpen]=useState(false),[clock,setClock]=useState(Date.now());
 const refreshRef=useRef<()=>void>(()=>{});
 const signature=applications.map(item=>`${item.id}:${item.status}:${item.claim?.id||''}:${item.manualSubmission?.state||''}`).sort().join('|');
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,inFlight=false,generation=0;
  async function read(showChecking=false){if(stopped||inFlight||document.hidden)return;inFlight=true;const ownGeneration=generation;controller=new AbortController();if(showChecking)setChecking(true);const timeout=setTimeout(()=>controller?.abort(),10000);
   try{const r=await fetch('/api/applications/browser-recovery',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const value=await r.json() as RecoverySnapshot;if(!Array.isArray(value.entries)||typeof value.blocked!=='boolean'||typeof value.needsRecovery!=='boolean'||!Number.isFinite(Date.parse(value.checkedAt)))throw Error();if(!stopped&&ownGeneration===generation){setSnapshot(value);setCheckedSignature(signature);setFailed(false);setClock(Date.now());if(expiry)clearTimeout(expiry);expiry=setTimeout(()=>setClock(Date.now()),Math.max(1,Date.parse(value.checkedAt)+20001-Date.now()));}}
   catch{if(!stopped&&ownGeneration===generation)setFailed(true);}finally{clearTimeout(timeout);inFlight=false;if(!stopped){setChecking(false);timer=setTimeout(()=>void read(),3000);}}
  }
  function refresh(){if(timer)clearTimeout(timer);if(!inFlight)void read(true);}
  function resumed(){if(document.hidden)return;generation++;controller?.abort();setCheckedSignature('');setFailed(true);refresh();}
  refreshRef.current=refresh;document.addEventListener('visibilitychange',resumed);window.addEventListener('pageshow',resumed);window.addEventListener('online',resumed);void read(true);
  return()=>{stopped=true;generation++;controller?.abort();if(timer)clearTimeout(timer);if(expiry)clearTimeout(expiry);document.removeEventListener('visibilitychange',resumed);window.removeEventListener('pageshow',resumed);window.removeEventListener('online',resumed);};
 },[signature]);
 const refresh=useCallback(()=>refreshRef.current(),[]),gate=recoveryGate(checkedSignature===signature?snapshot:null,expectsBrowser,failed,clock);
 return {snapshot,...gate,checking:checking||gate.checking,open,setOpen,refresh};
}

export function ApplicationSessionRecovery({recovery}:{recovery:ReturnType<typeof useApplicationSessionRecovery>}){
 const {snapshot,blocked,highlighted,checking,open,setOpen,refresh}=recovery;
 const affected=snapshot?.entries.filter(entry=>entry.state!=='connected')||[];
 return <>
  <button type="button" className={`button quiet application-recovery-button${highlighted?' needs-recovery':''}`} aria-expanded={open} aria-controls="application-session-recovery" onClick={()=>{setOpen(!open);refresh();}} title="Check and recover disconnected application browsers"><RefreshCw size={16}/>{highlighted?'Recover browser sessions — action needed':'Recover browser sessions'}</button>
  {blocked&&<p className="application-recovery-lock-note" role="status">Application cards are locked {checking?'while browser connections are checked':'until all required browser sessions are connected'}. Use Recover browser sessions to resolve each disconnected session.</p>}
  {open&&<section id="application-session-recovery" className="panel application-session-recovery" aria-label="Recover application browser sessions">
   <h3>{highlighted?<><TriangleAlert size={18}/>Browser sessions need attention</>:'Application browser connections'}</h3>
   <p>This checks the real application browsers after a restart or connection loss. It does not renew employer CAPTCHA, email codes or login sessions. Connected browsers are left alone. Safely unsent forms can be rebuilt with their original CV and saved answers after your confirmation; possibly submitted forms are never retried here.</p>
   <button className="button quiet" type="button" disabled={checking} onClick={refresh}>{checking?'Checking connections…':'Check connections again'}</button>
   {recovery.checking&&!snapshot&&<p role="status">Checking your saved application sessions…</p>}
   {recovery.checking&&highlighted&&<p role="status">Connection could not yet be confirmed. Keep the runner computer awake and online. Application access stays locked; no form has been restarted.</p>}
   {snapshot&&!affected.length&&!highlighted&&<p role="status">{snapshot.entries.length?'All required application browsers are connected. Your application cards are unlocked.':'No application currently needs a live browser. Your application cards are unlocked.'}</p>}
   {!!affected.length&&<ul className="application-recovery-list">{affected.map(entry=><li key={entry.requestId}><h4>{entry.title}</h4><p>{entry.company} · {entry.state==='restoring'?'Rebuilding':entry.state==='starting'?'Starting browser':entry.state==='closed_unsent'?'Unsent browser closed':'Disconnected'}</p><p>{entry.message}</p>{entry.manual?<ApplicationManualSubmit requestId={entry.requestId} recoveryOnly onHealth={refresh}/>:<p className="subtle">This request has no verified unsent manual form to rebuild. Check the original employer outcome and agent status before any retry. <a href="/account#application-agent-heading">Check your background agent</a>. Recovery does not restart this request or change its outcome.</p>}</li>)}</ul>}
   <p className="subtle">Ordinary employer questions and completed applications do not require an open browser. A disconnected computer and an expired employer verification are different: verification may still need you personally after the browser reconnects.</p>
  </section>}
 </>;
}
