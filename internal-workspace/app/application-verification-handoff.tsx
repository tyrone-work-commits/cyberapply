"use client";
import {useEffect,useState} from 'react';
import type {VerificationHandoff} from '@/lib/verification-handoff';
type HandoffResponse={active:boolean;handoff:VerificationHandoff|null;error?:string};
export function ApplicationVerificationHandoff({requestId}:{requestId:string}){
 const [handoff,setHandoff]=useState<VerificationHandoff|null>(null),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[approveHosts,setApproveHosts]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,loading=false,lastId='';
  async function read(){if(stopped||document.hidden||loading)return;loading=true;controller=new AbortController();const deadline=setTimeout(()=>controller?.abort(),10000);try{
   const r=await fetch('/api/applications/handoff?requestId='+encodeURIComponent(requestId),{cache:'no-store',signal:controller.signal}),p=await r.json() as HandoffResponse;if(!r.ok)throw Error(p.error||'Handoff unavailable.');
   if(!stopped){if(lastId!==p.handoff?.id){lastId=p.handoff?.id||'';setApproveHosts(false);}setHandoff(p.handoff);setActive(p.active);}
  }catch{/* Existing application progress stays visible while offline. */}finally{clearTimeout(deadline);loading=false;if(!stopped)timer=setTimeout(read,3000);}}
  function visible(){if(!document.hidden){if(timer)clearTimeout(timer);void read();}}
  document.addEventListener('visibilitychange',visible);void read();return()=>{stopped=true;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[requestId]);
 async function command(action:'open'|'resume'|'cancel'){
  if(!handoff||busy)return;setBusy(true);setMessage('');try{
   const r=await fetch('/api/applications/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,id:handoff.id,command:action,approvedHosts:action==='open'&&approveHosts?handoff.challengeHosts:[]})}),p=await r.json() as HandoffResponse;if(!r.ok)throw Error(p.error||'The handoff command was not accepted.');setHandoff(p.handoff);setActive(p.active);
   setMessage(action==='open'?'Opening the existing agent window on its computer…':action==='resume'?'Checking the same form before resuming…':'Stopping this handoff. No new application will be created.');
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 }
 if(!active||!handoff)return null;
 return <section className="panel application-detail-section" aria-label="Complete verification in the agent browser"><h3>Verification needed — agent paused</h3>
  <p>The agent keeps its existing form session, including any fields and CV already filled. Open that exact window on the computer running your background agent, complete the check yourself, then return here and resume.</p>
  {!!handoff.questions.length&&<ul>{handoff.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>}
  <p className="subtle">On a phone, use the computer running the agent for this step. Recording pauses while you have control. Complete verification only; do not click the employer’s Submit/Continue buttons, reload the form, or change Account Profile/Answers library during this handoff.</p>
  {!!handoff.challengeHosts.length&&handoff.state==='waiting'&&<label className="check-label"><input type="checkbox" checked={approveHosts} onChange={e=>setApproveHosts(e.target.checked)}/><span>Allow these verification-service destinations for this browser session only: {handoff.challengeHosts.join(', ')}. The check stays manual; CyberApply does not solve it or copy verification tokens.</span></label>}
  {handoff.code==='incomplete'&&<p role="status">The verification question still needs a selection in the agent window. Complete it there, then resume again.</p>}
  <div className="account-actions">
   {handoff.state==='waiting'&&<button type="button" className="button" disabled={busy||!!handoff.challengeHosts.length&&!approveHosts} onClick={()=>void command('open')}>Open exact agent browser</button>}
   {handoff.state==='opened'&&<button type="button" className="button" disabled={busy} onClick={()=>void command('resume')}>I completed verification — resume agent</button>}
   {['opening','resuming'].includes(handoff.state)&&<p role="status">{handoff.state==='opening'?'Waiting for the computer to open its existing window…':'Agent checking your completed verification…'}</p>}
   <button type="button" className="button quiet" disabled={busy} onClick={()=>void command('cancel')}>Cancel handoff</button>
  </div><p className="subtle">Session expires {new Date(handoff.expiresAt).toLocaleTimeString()}. Expired or closed browsers are not restarted automatically. Applied still requires employer confirmation.</p>{message&&<p role="status">{message}</p>}
 </section>;
}
