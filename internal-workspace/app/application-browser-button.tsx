"use client";
import{useEffect,useState}from'react';
import{Monitor}from'lucide-react';
import type{BrowserWindowState}from'@/lib/application-browser-window';
type BrowserResponse=BrowserWindowState&{applicationStatus?:string};
export function ApplicationBrowserButton({requestId,status}:{requestId:string;status:string}){
 const [windowState,setWindowState]=useState<BrowserWindowState>({available:false}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const endpoint='/api/applications/browser-window';
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  async function read(){controller=new AbortController();const deadline=setTimeout(()=>controller?.abort(),8000);try{const r=await fetch(endpoint+'?requestId='+encodeURIComponent(requestId),{cache:'no-store',signal:controller.signal});if(r.ok&&!stopped)setWindowState(await r.json() as BrowserResponse);}catch{}finally{clearTimeout(deadline);if(!stopped&&['queued','processing'].includes(status))timer=setTimeout(read,3000);}}
  void read();return()=>{stopped=true;controller?.abort();if(timer)clearTimeout(timer);};
 },[requestId,status]);
 async function open(){if(busy)return;setBusy(true);setMessage('');try{
  const r=await fetch(endpoint+'?requestId='+encodeURIComponent(requestId),{cache:'no-store'}),current=await r.json() as BrowserResponse;if(!r.ok)throw Error(current.error||'Browser status is unavailable.');setWindowState(current);
  if(!current.available)throw Error(['queued','processing'].includes(current.applicationStatus||'')?'Your request is saved. Wait for the agent to open this application, then try this button again.':'No active agent browser is available for this request. Closed sessions cannot be restored here; a fresh employer tab would not contain the filled form.');
  const opened=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,sessionId:current.sessionId,claimId:current.claimId})}),result=await opened.json() as BrowserResponse;if(!opened.ok)throw Error(result.error||'The existing browser could not be opened.');setWindowState(result);setMessage('Opening the exact filled form on the computer running your CyberApply agent. The agent keeps working; make changes only when it asks for a handoff.');
 }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
 return <div style={{minWidth:0,maxWidth:'100%'}}><button type="button" className="button quiet" disabled={busy} onClick={()=>void open()} title="Bring the agent’s existing application window to the front on its computer"><Monitor size={15}/>{busy?'Opening agent browser…':'Open employer application'}</button>{(message||windowState.opened||windowState.error)&&<p className="subtle" role="status" style={{maxWidth:480,overflowWrap:'anywhere'}}>{windowState.error?'The agent could not bring its window to the front. Use the CyberApply browser on the agent’s computer.':windowState.opened?'The existing agent browser is open on its computer. Your filled form and session are unchanged.':message}</p>}</div>;
}
