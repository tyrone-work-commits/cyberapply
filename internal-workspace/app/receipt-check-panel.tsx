"use client";
import {useEffect,useRef,useState} from 'react';
import {MailCheck,RefreshCw} from 'lucide-react';
type Packet={status?:string;error?:string;message?:string;connectHref?:string;checkedAt?:string;retryAfterMs?:number;confirmed?:string[];limited?:boolean};
export function ReceiptCheckPanel({enabled,pendingCount,busy,onChanged}:{enabled:boolean;pendingCount:number;busy:boolean;onChanged:()=>Promise<void>}){
 const [working,setWorking]=useState(false),[packet,setPacket]=useState<Packet|null>(null);
 const running=useRef(false),next=useRef(0),paused=useRef(false),callback=useRef(onChanged);callback.current=onChanged;
 async function check(action:'enable'|'disable'|'check',automatic=false){
  if(running.current||busy)return;running.current=true;setWorking(true);
  if(!automatic)paused.current=false;
  try{
   const r=await fetch('/api/applications/receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,automatic}),cache:'no-store',signal:AbortSignal.timeout(60000)});
   const value=await r.json() as Packet;setPacket(value);
   next.current=Date.now()+Math.max(120000,value.retryAfterMs||0);
   if(['reauthentication_required','connector_access_disabled','tool_not_allowed','mailbox_mismatch'].includes(value.status||''))paused.current=true;
   if(value.confirmed?.length||action!=='check')await callback.current();
  }catch{setPacket({error:'Receipt checking could not finish. Existing outcomes are unchanged; no application was retried.'});next.current=Date.now()+120000;}
  finally{running.current=false;setWorking(false);}
 }
 const checker=useRef(check);checker.current=check;
 useEffect(()=>{
  if(!enabled||!pendingCount)return;
  const tick=()=>{if(!document.hidden&&!paused.current&&Date.now()>=next.current)void checker.current('check',true);};
  tick();const timer=setInterval(tick,10000);return()=>clearInterval(timer);
 },[enabled,pendingCount,busy]);
 return <section className="panel application-detail-section" aria-label="Employer receipt checking">
  <div className="section-title"><h3><MailCheck size={19}/> Employer receipt checking</h3><span>{working?'Checking…':enabled?'Automatic checks on':'Automatic checks off'}</span></div>
  <p>Confirm applications from employer emails in your connected Gmail. We match the exact role, employer, applicant email, date and sender authentication before recording Applied.</p>
  <p className="subtle">Automatic checks run about every two minutes while Applications is open and visible. Missing or ambiguous receipts stay <strong>Awaiting confirmation</strong>; the app will not submit again. Gmail must match your CyberApply sign-in.</p>
  <div className="application-overview-actions"><button className="button" type="button" disabled={busy||working} onClick={()=>void check(enabled?'disable':'enable')}>{enabled?'Turn off automatic checks':'Enable automatic receipt checks'}</button><button className="button quiet" type="button" disabled={busy||working||!pendingCount} onClick={()=>void check('check')}><RefreshCw size={15}/>Check employer receipts</button></div>
  {packet&&<div className="subtle" role="status"><p>{packet.error||packet.message|| (packet.status==='disabled'?'Automatic checks are off.':'Receipt check completed.')}</p>{packet.checkedAt&&<small>Last check: {new Date(packet.checkedAt).toLocaleString()}</small>}{packet.limited&&<p>The bounded search may not include every message. Check your mailbox or employer portal if confirmation is still missing.</p>}{packet.connectHref&&<p><a className="button quiet" href={packet.connectHref} target="_top">Connect Gmail</a></p>}</div>}
  <small>Read-only mail access. Email bodies are not stored; a confirmed application keeps only a receipt link and short supporting excerpt. Spam, Trash, Sent, drafts, attachments and forwarded messages are excluded.</small>
 </section>;
}
