"use client";
import {useEffect,useState} from 'react';
import type {VerificationHandoff} from '@/lib/verification-handoff';
type HandoffResponse={active:boolean;handoff:VerificationHandoff|null;error?:string};
export function ApplicationVerificationHandoff({requestId,showUnavailable=false}:{requestId:string;showUnavailable?:boolean}){
 const [loaded,setLoaded]=useState(false),[handoff,setHandoff]=useState<VerificationHandoff|null>(null),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[approveHosts,setApproveHosts]=useState(false);
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,loading=false,lastId='';
  async function read(){if(stopped||document.hidden||loading)return;loading=true;controller=new AbortController();const deadline=setTimeout(()=>controller?.abort(),10000);try{
   const r=await fetch('/api/applications/handoff?requestId='+encodeURIComponent(requestId),{cache:'no-store',signal:controller.signal}),p=await r.json() as HandoffResponse;if(!r.ok)throw Error(p.error||'Handoff unavailable.');
   if(!stopped){if(lastId!==p.handoff?.id){lastId=p.handoff?.id||'';setApproveHosts(false);}setHandoff(p.handoff);setActive(p.active);setLoaded(true);}
  }catch{/* Existing application progress stays visible while offline. */}finally{clearTimeout(deadline);loading=false;if(!stopped)timer=setTimeout(read,3000);}}
  function visible(){if(!document.hidden){if(timer)clearTimeout(timer);void read();}}
  document.addEventListener('visibilitychange',visible);void read();return()=>{stopped=true;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
 },[requestId]);
 async function command(action:'open'|'resume'|'cancel'){
  if(!handoff||busy)return;setBusy(true);setMessage('');try{
   const r=await fetch('/api/applications/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,id:handoff.id,command:action,approvedHosts:action==='open'&&approveHosts?handoff.challengeHosts:[]})}),p=await r.json() as HandoffResponse;if(!r.ok)throw Error(p.error||'The handoff command was not accepted.');setHandoff(p.handoff);setActive(p.active);setLoaded(true);
   setMessage(action==='open'?'Opening the existing agent window on its computer…':action==='resume'?'Checking the same form before resuming…':'Stopping this handoff. No new application will be created.');
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 }
 if(!active||!handoff)return showUnavailable&&!loaded?<p className="subtle" role="status">Checking the agent’s existing browser session…</p>:showUnavailable?<p className="subtle">No active agent browser is available for this request. A separately opened employer tab cannot return control to the agent. Closed sessions cannot be restored automatically.</p>:null;
 const captcha=handoff.kind==='recaptcha',afterSubmit=captcha&&handoff.phase==='after_submit';
 return <section className="panel application-detail-section" aria-label={captcha?'Complete employer reCAPTCHA personally':'Answer the human or AI dropdown in the agent browser'}><h3>{captcha?'Employer reCAPTCHA — manual check':'Human or AI dropdown — agent paused'}</h3>
  <p>{captcha?'This is a separate reCAPTCHA handoff. Open the existing agent browser on its computer and complete any visible employer check yourself. CyberApply does not solve challenges or read verification tokens. The form and chosen CV stay in the same session.':'This handoff is only for “Which of the following best describes you?” when the dropdown offers human and AI agent options. The agent keeps the same browser session, cookies, filled form and chosen CV in memory while you answer personally.'}</p>
  {!captcha&&<>
   <h4>How to answer and keep your selection</h4>
   <ol>
    <li>Click <strong>Open exact agent browser</strong> on this application card, on the computer running your background agent. If it is already open, use that same window.</li>
    <li>Select your answer from the employer’s dropdown yourself.</li>
    <li>Click somewhere outside the dropdown and check that your chosen answer is still displayed.</li>
    <li>Leave that employer window open, return to CyberApply and click <strong>Return control to agent</strong>. The agent checks your selection in the same filled form before continuing.</li>
   </ol>
   <h4>Keep this browser session open</h4>
   <p>Do not close or refresh the employer page, navigate away, use a separate employer tab, or restart the agent. Keep the computer awake. Closing or refreshing the page can lose your selection; a new tab does not share the agent’s filled form.</p>
   <p className="subtle">Your selection stays in this browser session; it is not guaranteed to survive closing or refreshing it. Do not change Account Profile or Answers library during the handoff. For now, answer only this dropdown and return control; wait for the separate Ready – submit it yourself instruction before pressing the employer’s final Submit button.</p>
  </>}
  {captcha&&<p role="status">{afterSubmit?'Submit has already been clicked once. Do not click it again. After you return control, the agent only checks the outcome of that original attempt.':'If no check is visible, return control after it loads. Some employers run invisible reCAPTCHA only when the agent clicks Submit for the first time.'}</p>}
  {!!handoff.questions.length&&<ul>{handoff.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>}
  <p className="subtle">On a phone, use the computer running the agent for this step. Recording pauses while you have control. Complete verification only; do not click the employer’s Submit/Continue buttons, reload the form, or change Account Profile/Answers library during this handoff.</p>
  {captcha&&handoff.state==='waiting'&&!!handoff.challengeHosts.length&&<label className="check-label"><input type="checkbox" checked={approveHosts} onChange={e=>setApproveHosts(e.target.checked)}/><span>Allow Google reCAPTCHA to load from {handoff.challengeHosts.join(', ')} for this browser session. This permits the employer’s normal verification requests; it does not authorize CyberApply to solve the check.</span></label>}
  {handoff.code==='incomplete'&&<p role="status">{captcha?'The visible check still needs your attention. Complete it in the agent window, then return control.':'The verification question still needs a selection in the agent window. Complete it there, then resume again.'}</p>}
  <div className="account-actions">
   {handoff.state==='waiting'&&<button type="button" className="button" disabled={busy||captcha&&!!handoff.challengeHosts.length&&!approveHosts} onClick={()=>void command('open')}>Open exact agent browser</button>}
   {handoff.state==='opened'&&<button type="button" className="button" disabled={busy} onClick={()=>void command('resume')}>Return control to agent</button>}
   {['opening','resuming'].includes(handoff.state)&&<p role="status">{handoff.state==='opening'?'Waiting for the computer to open its existing window…':'Agent checking your completed verification…'}</p>}
   <button type="button" className="button quiet" disabled={busy} onClick={()=>void command('cancel')}>Cancel handoff</button>
  </div><p className="subtle">{handoff.persistent?'The exact browser stays in memory until you return control or cancel. Keep the computer awake and leave that browser open. After return, the agent checks the same form and original CV, then continues; Greenhouse/reCAPTCHA final Submit still belongs to you.':`Session expires ${new Date(handoff.expiresAt).toLocaleTimeString()}. Expired browsers are not restarted automatically.`} Closed browsers cannot be restored automatically. Applied still requires employer confirmation.</p>{message&&<p role="status">{message}</p>}
 </section>;
}
