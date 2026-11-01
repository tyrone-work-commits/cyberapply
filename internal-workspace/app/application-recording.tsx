"use client";
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,Film,LockKeyhole,RefreshCw,X} from 'lucide-react';
type Recording={attempt:string;duration:number;startedAt:string;recordedAt:string;partial:boolean;reason:string;size:number};
export function ApplicationRecording({requestId,onClose}:{requestId:string;onClose?:()=>void}){
 const [items,setItems]=useState<Recording[]>([]),[attempt,setAttempt]=useState(''),[cursor,setCursor]=useState<string|null>(null),[message,setMessage]=useState('Loading your private recordings…'),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false),[refresh,setRefresh]=useState(0);
 const close=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),generation=useRef(0);
 const base='/api/applications/recordings?requestId='+encodeURIComponent(requestId);
 useEffect(()=>{if(!onClose)return;const query=matchMedia('(max-width:600px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[onClose]);
 useEffect(()=>{
  if(!mobile)return;const overflow=document.body.style.overflow,shell=document.querySelector<HTMLElement>('.app-shell'),inert=shell?.inert;
  document.body.style.overflow='hidden';if(shell)shell.inert=true;close.current?.focus();
  return()=>{document.body.style.overflow=overflow;if(shell)shell.inert=!!inert;document.getElementById('watch-recording-'+requestId)?.focus();};
 },[mobile,requestId]);
 useEffect(()=>{
  const id=++generation.current,controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,checks=0;
  async function load(){setBusy(true);try{
   const r=await fetch(base,{cache:'no-store',signal:controller.signal}),p=await r.json() as {items:Recording[];nextCursor:string|null;error?:string};if(!r.ok)throw Error(p.error||'Recordings could not be loaded.');if(generation.current!==id)return;
   setItems(p.items);setCursor(p.nextCursor);setAttempt(current=>p.items.some(item=>item.attempt===current)?current:p.items[0]?.attempt||'');setMessage(p.items.length?'':'No saved recording yet. New runs save a recording after the agent finishes or pauses. Earlier runs cannot be recreated.');
   if(!p.items.length&&checks++<18)timer=setTimeout(load,5000);
  }catch(error){if(!controller.signal.aborted&&generation.current===id)setMessage((error as Error).message);}finally{if(generation.current===id)setBusy(false);}}
  void load();return()=>{generation.current++;controller.abort();if(timer)clearTimeout(timer);};
 },[requestId,refresh,base]);
 async function older(){if(!cursor||busy)return;setBusy(true);try{const r=await fetch(base+'&cursor='+encodeURIComponent(cursor),{cache:'no-store'}),p=await r.json() as {items:Recording[];nextCursor:string|null;error?:string};if(!r.ok)throw Error(p.error||'Older recordings could not be loaded.');setItems(current=>[...current,...p.items.filter(item=>!current.some(old=>old.attempt===item.attempt))]);setCursor(p.nextCursor);}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
 const chosen=items.find(item=>item.attempt===attempt);
 function keyboard(event:React.KeyboardEvent){if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}if(mobile&&event.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button,select,video[controls]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}
 const content=<section ref={panel} className={onClose?'application-live-view'+(mobile?' mobile-live-video':''):'agent-watch-page'} role={mobile?'dialog':'region'} aria-modal={mobile||undefined} aria-label="Saved application recordings" onKeyDown={keyboard}>
  <header className="agent-watch-header">{!onClose&&<a className="brand" href="/workspace">CyberApply</a>}<strong><Film size={19}/>Application recording</strong><>{onClose?<button ref={close} type="button" className="button quiet" onClick={onClose}><X size={17}/>{mobile?'Close':'Hide'}</button>:<a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a>}</></header>
  <p className="subtle"><LockKeyhole size={15}/>Private to your account. Replaying never applies, submits or retries a job.</p>
  {message&&<p role="status">{message}</p>}
  {!!items.length&&<label>Recorded run<select value={attempt} onChange={event=>setAttempt(event.target.value)}>{items.map(item=><option value={item.attempt} key={item.attempt}>{new Date(item.startedAt).toLocaleString()} · {Math.round(item.duration)} seconds{item.partial?' · Partial recording':''}</option>)}</select></label>}
  {chosen&&<><div className="agent-watch-screen"><video key={attempt} src={base+'&attempt='+encodeURIComponent(attempt)} autoPlay muted controls playsInline preload="metadata" controlsList="nodownload" onError={()=>setMessage('This recording could not play. Refresh the list or try an updated browser.')}/></div>{chosen.partial&&<p role="status">Partial recording: {chosen.reason==='recording_limit'?'the recording reached its time or size limit.':'capture was interrupted.'} The application’s own status is shown separately.</p>}<p className="subtle">Recorded {new Date(chosen.recordedAt).toLocaleString()}. This shows the agent’s browser activity; it does not by itself prove employer submission. Private sign-in windows are excluded.</p></>}
  <div className="application-overview-actions"><button type="button" className="button quiet" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={15}/>Refresh recordings</button>{cursor&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void older()}>Load older runs</button>}</div>
  <p className="subtle">Recordings may contain CV and profile information entered in the form. They stay private until you permanently delete the application or your account.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
