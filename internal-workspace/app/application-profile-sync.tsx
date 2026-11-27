"use client";
import {useEffect,useState} from 'react';
import type {ApplicationRequest} from '@/lib/cyber-domain';
type SyncInfo={outOfSync:boolean;changed:boolean;state:string;canSync:boolean;sameBrowser:boolean};
export function ApplicationProfileSync({application}:{application:ApplicationRequest}){
 const [info,setInfo]=useState<SyncInfo|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  let stopped=false,loading=false;const controller=new AbortController();
  async function read(){if(document.hidden||loading)return;loading=true;try{const r=await fetch('/api/applications/profile-sync?requestId='+encodeURIComponent(application.id),{cache:'no-store',signal:controller.signal});const p=await r.json() as {sync:SyncInfo;error?:string};if(r.ok&&!stopped)setInfo(p.sync);}catch{}finally{loading=false;}}
  void read();const timer=setInterval(()=>void read(),5000);const visible=()=>{if(!document.hidden)void read();};document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[application.id,application.claim?.id]);
 async function sync(){setBusy(true);setMessage('');try{const r=await fetch('/api/applications/profile-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:application.id,claimId:application.claim?.id})});const p=await r.json() as {sync:SyncInfo;error?:string};if(!r.ok)throw Error(p.error||'Synchronization was not saved.');setInfo(p.sync);setMessage(p.sync.state==='pending'?'The agent is updating this same filled form. No new application is being started.':'Saved information synchronized. You can open the exact agent browser and continue.');}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
 if(!application.applicantProfile||['applied','uncertain','failed'].includes(application.status))return null;
 return <section className="application-detail-section" aria-label="Prepared answers synchronization">
  {info?.outOfSync&&<p role="status"><strong>{info.state==='pending'?'Synchronizing prepared answers':info.state==='failed'?'Prepared answers need attention':'Prepared answers are not in sync'}</strong><br/>{info.state==='pending'?'The agent is applying your saved information to this exact employer form. Wait for synchronization to finish before returning control.':info.state==='failed'?'The updated information could not fill every required field. Check your saved details and synchronize again.':'Your Account Profile or Answers library changed after preparation. You can still open the exact browser and answer the verification question. Synchronize before the agent continues.'}</p>}
  {info&&(info.canSync||info.outOfSync)&&<button type="button" className="button quiet" disabled={busy||info.state==='pending'&&!info.changed||!info.canSync} onClick={()=>void sync()}>{busy?'Synchronizing…':'Synchronize prepared answers'}</button>}
  {info?.outOfSync&&!info.canSync&&info.state!=='pending'&&<p className="subtle">The current browser must be safely paused and support in-place synchronization. Opening it for verification stays available. No submitted or uncertain application will be restarted.</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
