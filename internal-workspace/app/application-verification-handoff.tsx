"use client";
import {useEffect,useState} from 'react';
import type {VerificationHandoff} from '@/lib/verification-handoff';
type HandoffResponse={active:boolean;handoff:VerificationHandoff|null;error?:string};
export function ApplicationVerificationHandoff({requestId}:{requestId:string}){
 const [handoff,setHandoff]=useState<VerificationHandoff|null>(null),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[approveHosts,setApproveHosts]=useState(false);
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
 const captcha=handoff.kind==='recaptcha',afterSubmit=captcha&&handoff.phase==='after_submit';
 return <section className="panel application-detail-section" aria-label={captcha?'Complete employer reCAPTCHA personally':'Answer the human or AI dropdown in the agent browser'}><h3>{captcha?'Employer reCAPTCHA — manual check':'Human or AI dropdown — agent paused'}</h3>
  <p>{captcha?'This is a separate reCAPTCHA handoff. Open the existing agent browser on its computer and complete any visible employer check yourself. CyberApply does not solve challenges or read verification tokens. The form and chosen CV stay in the same session.':'This handoff is only for “Which of the following best describes you?” when the dropdown offers human and AI agent options. The agent keeps the same form and chosen CV. Open its exact window on the computer running your background agent, select your answer yourself, then return here and resume.'}</p>
  {captcha&&<p role="status">{afterSubmit?'Submit has already been clicked once. Do not click it again. After you return control, the agent only checks the outcome of that original attempt.':'If no check is visible, return control after it loads. Some employers run invisible reCAPTCHA only when the agent clicks Submit for the first time.'}</p>}
  {!!handoff.questions.length&&<ul>{handoff.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>}
  <p className="subtle">On a phone, use the computer running the agent for this step. Recording pauses while you have control. Complete verification only; do not click the employer’s Submit/Continue buttons, reload the form, or change Account Profile/Answers library during this handoff.</p>
  {captcha&&handoff.state==='waiting'&&!!handoff.challengeHosts.length&&<label className="check-label"><input type="checkbox" checked={approveHosts} onChange={e=>setApproveHosts(e.target.checked)}/><span>Allow Google reCAPTCHA to load from {handoff.challengeHosts.join(', ')} for this browser session. This permits the employer’s normal verification requests; it does not authorize CyberApply to solve the check.</span></label>}
  {handoff.code==='incomplete'&&<p role="status">{captcha?'The visible check still needs your attention. Complete it in the agent window, then return control.':'The verification question still needs a selection in the agent window. Complete it there, then resume again.'}</p>}
  <div className="account-actions">
   {handoff.state==='waiting'&&<button type="button" className="button" disabled={busy||captcha&&!!handoff.challengeHosts.length&&!approveHosts} onClick={()=>void command('open')}>Open exact agent browser</button>}
   {handoff.state==='opened'&&<button type="button" className="button" disabled={busy} onClick={()=>void command('resume')}>{captcha?'Return control to agent':'I completed verification — resume agent'}</button>}
   {['opening','resuming'].includes(handoff.state)&&<p role="status">{handoff.state==='opening'?'Waiting for the computer to open its existing window…':'Agent checking your completed verification…'}</p>}
   <button type="button" className="button quiet" disabled={busy} onClick={()=>void command('cancel')}>Cancel handoff</button>
  </div><p className="subtle">Session expires {new Date(handoff.expiresAt).toLocaleTimeString()}. Expired or closed browsers are not restarted automatically. Applied still requires employer confirmation.</p>{message&&<p role="status">{message}</p>}
 </section>;
}
