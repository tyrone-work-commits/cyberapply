"use client";
import {useEffect,useRef,useState} from 'react';
import '../workspace-header.css';
import './live-video.css';
import {ApplicationRecording} from '../application-recording';
import {ApplicationVerificationHandoff} from '../application-verification-handoff';
import {ApplicationManualSubmit} from '../application-manual-submit';
import {createPortal} from 'react-dom';
import {ArrowLeft,Video,LockKeyhole,X} from 'lucide-react';

type Info={active:boolean;status:string;title:string;company:string;message:string;control?:string;privateCheck?:boolean};
export default function AgentWatch({requestId,embedded=false,onClose}:{requestId:string;embedded?:boolean;onClose?:()=>void}){
 const panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
 const [info,setInfo]=useState<Info|null>(null),[message,setMessage]=useState('Connecting to your private application stream…'),[mobile,setMobile]=useState(false);
 useEffect(()=>{if(!embedded)return;const query=matchMedia('(max-width:600px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[embedded]);
 useEffect(()=>{
  if(!mobile)return;const previous=document.activeElement as HTMLElement|null,bodyOverflow=document.body.style.overflow,shell=document.querySelector<HTMLElement>('.app-shell'),wasInert=shell?.inert;
  document.body.style.overflow='hidden';if(shell)shell.inert=true;close.current?.focus();
  return()=>{document.body.style.overflow=bodyOverflow;if(shell)shell.inert=!!wasInert;(document.getElementById('watch-live-'+requestId)||previous)?.focus();};
 },[mobile]);
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  setInfo(null);setMessage('Connecting to your private application stream…');
  async function poll(){
   if(disposed)return;
   if(document.hidden){timer=setTimeout(poll,2000);return;}
   controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),12000);
   try{
    const response=await fetch('/api/applications/watch?part=status&requestId='+encodeURIComponent(requestId),{cache:'no-store',signal:controller.signal}),data=await response.json() as Info&{error?:string};
    if(!response.ok)throw Error(data.error||'The application status is unavailable.');
    if(!disposed){setInfo(data);setMessage(data.message);}
   }catch(error){if(!disposed)setMessage((error as Error).name==='AbortError'?'Status connection timed out. Saved footage remains available; reconnecting.':(error as Error).message);}
   finally{clearTimeout(timeout);if(!disposed)timer=setTimeout(poll,3000);}
  }
  void poll();return()=>{disposed=true;controller?.abort();if(timer)clearTimeout(timer);};
 },[requestId]);
 function keyboard(event:React.KeyboardEvent){
  if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}
  if(mobile&&event.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],video[controls]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
 }
 const content=<section ref={panel} className={embedded?'application-live-view'+(mobile?' mobile-live-video':''):'agent-watch-page'} role={mobile?'dialog':'region'} aria-modal={mobile||undefined} aria-label="Live application agent video" onKeyDown={keyboard}>
  <header className="agent-watch-header signed-in-page-header">{!embedded&&<a className="brand" href="/workspace">CyberApply</a>}<strong><Video size={19}/>Live now</strong>{onClose?<button ref={close} type="button" className="button quiet" onClick={onClose}><X size={17}/>{mobile?'Close':'Hide'}</button>:<a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a>}</header>
  <div className="agent-watch-intro"><h2>{info?.title||'Your application'}{info?.company?' · '+info.company:''}</h2><p role="status">Current agent status: {message}</p><p className="subtle"><LockKeyhole size={15}/>Rewind or pause this same timeline, then choose Go live. New uploaded footage extends it automatically, including after the agent resumes. Playback is buffered and may trail the actual browser by several seconds.</p></div>
  <ApplicationRecording requestId={requestId} embedded dvr/>
  {info?.privateCheck&&<p className="live-handoff-message" role="status">A private verification check is in progress. Its frames are hidden; you can still watch earlier footage.</p>}
  {info&&['needs_input','manual','resuming','submit'].includes(info.control||'')&&<p className="live-handoff-message" role="status">{info.message}</p>}
  {info?.status==='processing'&&<ApplicationVerificationHandoff requestId={requestId}/>}
  {info?.control==='submit'&&<ApplicationManualSubmit requestId={requestId}/>}
  <p className="subtle">Take manual control on the computer running the agent. Keep its exact browser open, fill the requested fields and return control. Final Submit on Greenhouse/reCAPTCHA forms remains yours. Watching, rewinding or Go live never applies, retries or submits a job.</p>
  <p className="subtle">One private, silent video of the available process. Ordinary manual actions are included in new recorder runs; passwords, emailed codes and CAPTCHA checks stay hidden. Idle manual waits are shortened. Missing or limited footage is reported in the player and cannot be reconstructed.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
