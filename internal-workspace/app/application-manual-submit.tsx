"use client";
import {useEffect,useState} from 'react';
import type {ManualSubmission} from '@/lib/manual-submission';
export function ApplicationManualSubmit({requestId}:{requestId:string}){
 const [session,setSession]=useState<ManualSubmission|null>(null),[busy,setBusy]=useState(false),[approvedScope,setApprovedScope]=useState<string|null>(null),[message,setMessage]=useState('');
 useEffect(()=>{let stop=false,timer:ReturnType<typeof setTimeout>,controller:AbortController|undefined;
  async function read(){controller=new AbortController();const deadline=setTimeout(()=>controller?.abort(),10000);try{const r=await fetch('/api/applications/manual-submit?requestId='+encodeURIComponent(requestId),{cache:'no-store',signal:controller.signal});if(r.ok){const p=await r.json() as {session:ManualSubmission|null;error?:string};if(!stop)setSession(p.session);}}catch{/* Keep the existing browser instructions during temporary outages. */}finally{clearTimeout(deadline);if(!stop)timer=setTimeout(read,3000);}}
  void read();return()=>{stop=true;controller?.abort();clearTimeout(timer);};
 },[requestId]);
 async function command(action:'open'|'cancel'){
  if(!session||busy||action==='open'&&!approve)return;setBusy(true);setMessage('');try{const r=await fetch('/api/applications/manual-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,id:session.id,command:action,openConfirmed:action==='open'&&approve,approvedHosts:action==='open'&&approve?session.challengeHosts:[]})}),p=await r.json() as {session:ManualSubmission|null;error?:string};if(!r.ok)throw Error(p.error||'Command was not saved.');setSession(p.session);if(action==='open')setApprovedScope(null);setMessage(action==='cancel'?'Cancellation requested. Waiting for your computer to close this exact browser.':'Opening the existing CyberApply browser window on your computer.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
 }
 const pending=session?.challengeHosts.filter(host=>!session.approvedHosts.includes(host))||[],approvalScope=requestId+'|'+(session?.id||'')+'|'+pending.join(','),approve=!!session&&approvedScope===approvalScope;
 if(!session||!['ready','needs_submit','cancel_requested'].includes(session.state))return null;
 return <section className="panel application-detail-section" aria-label="Submit this application yourself"><h3>{session.state==='needs_submit'?'Needs you: submit':session.state==='cancel_requested'?'Cancellation requested':'Ready – submit it yourself'}</h3>
  <p><strong>Open the CyberApply browser window and press Submit</strong></p>
  <p>The filled browser stays minimized until you tick the box below and open it. It stays open on your computer until you submit or cancel. Complete any reCAPTCHA yourself in that same window. CyberApply watches for the employer’s confirmation; it will not press Submit or retry it.</p>
  {session.state==='needs_submit'&&<p role="status">The employer asked you to complete reCAPTCHA and resubmit. Finish that check and press Submit yourself. The agent will keep waiting.</p>}
  <label className="check-label"><input type="checkbox" checked={approve} disabled={busy||session.state==='cancel_requested'} onChange={e=>setApprovedScope(e.target.checked?approvalScope:null)}/><span>{pending.length?<>I am ready to open this application’s browser window and allow the employer’s reCAPTCHA to load from {pending.join(', ')} in this session. I will complete the check personally.</>:'I am ready to open the CyberApply browser window for this application.'}</span></label>
  <div className="account-actions"><button className="button" type="button" disabled={busy||session.state==='cancel_requested'||!approve} onClick={()=>void command('open')}>Open CyberApply browser window</button><button className="button quiet" type="button" disabled={busy||session.state==='cancel_requested'} onClick={()=>void command('cancel')}>Cancel</button></div>
  <p className="subtle">Cancelling stops this browser session; it does not withdraw anything the employer may already have received. Keep your computer awake. There is no automatic waiting timeout.</p>{message&&<p role="status">{message}</p>}
 </section>;
}
