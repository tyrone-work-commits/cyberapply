"use client";
import {useEffect,useRef,useState} from 'react';
import './workspace-header.css';
import {createPortal} from 'react-dom';
import {ArrowLeft,ExternalLink,Film,LockKeyhole,RefreshCw,X} from 'lucide-react';
import {applicationRecordingTimeline,recordingPollDelay,recordingViewMessage,type RecordingSnapshot} from '@/lib/recording-view-state';
export function ApplicationRecording({requestId,onClose}:{requestId:string;onClose?:()=>void}){
 const [snapshot,setSnapshot]=useState<RecordingSnapshot|null>(null),[message,setMessage]=useState('Loading your private application video…'),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false),[refresh,setRefresh]=useState(0);
 const video=useRef<HTMLVideoElement>(null),blob=useRef(''),resume=useRef({requestId:'',time:0,paused:false});
 const [media,setMedia]=useState({requestId:'',url:''}),[preparing,setPreparing]=useState(false),[playbackError,setPlaybackError]=useState('');
 const close=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),generation=useRef(0);
 const base='/api/applications/recordings?requestId='+encodeURIComponent(requestId);
 useEffect(()=>{setSnapshot(null);},[requestId]);
 useEffect(()=>{if(!onClose)return;const query=matchMedia('(max-width:600px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[onClose]);
 useEffect(()=>{
  if(!mobile)return;const overflow=document.body.style.overflow,shell=document.querySelector<HTMLElement>('.app-shell'),inert=shell?.inert;
  document.body.style.overflow='hidden';if(shell)shell.inert=true;close.current?.focus();
  return()=>{document.body.style.overflow=overflow;if(shell)shell.inert=!!inert;document.getElementById('watch-recording-'+requestId)?.focus();};
 },[mobile,requestId]);
 useEffect(()=>{
  const id=++generation.current;let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,loading=false,delay=5000;
  async function load(){
   if(document.hidden||loading)return;if(timer)clearTimeout(timer);loading=true;setBusy(true);controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),15000);
   try{
    const r=await fetch(base,{cache:'no-store',signal:controller.signal}),p=await r.json() as RecordingSnapshot&{error?:string};if(!r.ok)throw Error(p.error||'Recordings could not be loaded.');if(generation.current!==id)return;
    setSnapshot(p);setMessage(recordingViewMessage(p));delay=recordingPollDelay(p);
   }catch(error){if(generation.current===id){setMessage((error as Error).name==='AbortError'?'Recording refresh timed out. Retrying automatically.':(error as Error).message);delay=15000;}}
   finally{clearTimeout(timeout);loading=false;if(generation.current===id){setBusy(false);if(!document.hidden)timer=setTimeout(load,delay);}}
  }
  function visible(){if(document.hidden){if(timer)clearTimeout(timer);}else void load();}
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);void load();
  return()=>{generation.current++;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[requestId,refresh,base]);
 let timeline:ReturnType<typeof applicationRecordingTimeline>=null,timelineError='';
 try{if(snapshot)timeline=applicationRecordingTimeline(snapshot);}catch(error){timelineError=(error as Error).message;}
 const signature=JSON.stringify(timeline?.parts.map(part=>[part.attempt,part.part,part.duration])||[]);
 useEffect(()=>()=>{if(blob.current)URL.revokeObjectURL(blob.current);},[]);
 useEffect(()=>{
  const controller=new AbortController();let disposed=false;
  if(!timeline)return;
  setPlaybackError('');
  const ordered=timeline.parts;
  const url=(part:typeof ordered[number])=>base+'&attempt='+encodeURIComponent(part.attempt)+(part.part===null?'':'&part='+part.part);
  async function prepare(){
   setPreparing(true);
   try{
    let source:string;
    if(ordered.length===1)source=url(ordered[0]);
    else{
     if(timeline!.size>48_000_000)throw Error('This recording exceeds the playback limit.');
     const {combineRecordingParts}=await import('@/lib/continuous-recording'),buffers:ArrayBuffer[]=[];let size=0;
     for(const part of ordered){
      const response=await fetch(url(part),{cache:'no-store',signal:controller.signal});
      if(!response.ok||!response.headers.get('content-type')?.startsWith('video/mp4'))throw Error('The private recording could not be loaded. Refresh recordings to try again.');
      const data=await response.arrayBuffer();size+=data.byteLength;if(size>48_000_000)throw Error('This recording exceeds the playback limit.');buffers.push(data);
     }
     if(disposed)return;
     source=URL.createObjectURL(new Blob([combineRecordingParts(buffers)],{type:'video/mp4'}));
    }
    if(disposed){if(source.startsWith('blob:'))URL.revokeObjectURL(source);return;}
    const node=video.current;resume.current={requestId,time:media.requestId===requestId?node?.currentTime||0:0,paused:media.requestId===requestId?!!node?.paused:false};
    const previous=blob.current;blob.current=source.startsWith('blob:')?source:'';setMedia({requestId,url:source});if(previous)URL.revokeObjectURL(previous);
   }catch(error){if(!controller.signal.aborted&&!disposed)setPlaybackError((error as Error).message);}finally{if(!disposed)setPreparing(false);}
  }
  void prepare();return()=>{disposed=true;controller.abort();};
 // Refreshing unchanged metadata must not reset playback or repeat downloads.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[requestId,signature,base,refresh]);
 function loaded(){const node=video.current,saved=resume.current;if(!node||saved.requestId!==requestId)return;if(saved.time>0)node.currentTime=Math.min(saved.time,Math.max(0,node.duration-.01));if(saved.paused)node.pause();}
 function keyboard(event:React.KeyboardEvent){if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}if(mobile&&event.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button,select,video[controls]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}
 const content=<section ref={panel} className={onClose?'application-live-view'+(mobile?' mobile-live-video':''):'agent-watch-page'} role={mobile?'dialog':'region'} aria-modal={mobile||undefined} aria-label="Saved application recordings" onKeyDown={keyboard}>
  <header className="agent-watch-header signed-in-page-header">{!onClose&&<a className="brand" href="/workspace">CyberApply</a>}<strong><Film size={19}/>Application recording</strong><>{onClose?<button ref={close} type="button" className="button quiet" onClick={onClose}><X size={17}/>{mobile?'Close':'Hide'}</button>:<a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a>}</></header>
  <p className="subtle"><LockKeyhole size={15}/>Private to your account. Replaying never applies, submits or retries a job.</p>
  {snapshot&&<div className="application-detail-section"><h2>{snapshot.employer.title}</h2><p>{snapshot.employer.company}</p>{snapshot.employer.url&&<a className="button quiet" href={snapshot.employer.url} target="_blank" rel="noopener noreferrer">Open employer application<ExternalLink size={15}/><span className="sr-only"> (opens in a new tab)</span></a>}<p className="subtle">{snapshot.applicationStatus==='uncertain'?'Employer receipt remains unconfirmed. Do not submit again until its outcome is checked.':snapshot.applicationStatus==='applied'?'Employer confirmation is recorded in Applications.':'See Applications for the employer outcome.'}</p></div>}
  {message&&<p role="status">{message}</p>}
  {timelineError&&<p role="alert">{timelineError}</p>}
  {timeline&&<>{preparing&&<p role="status">Updating your continuous application video…</p>}{playbackError&&<p role="alert">{playbackError}</p>}<div className="agent-watch-screen"><video ref={video} src={media.requestId===requestId?media.url:undefined} onLoadedMetadata={loaded} autoPlay muted controls playsInline preload="auto" controlsList="nodownload" onError={()=>{if(!preparing)setPlaybackError('This video could not play. Refresh the video or try an updated browser.');}}/></div>{timeline.partial&&<p role="status">Some footage is missing or capture was interrupted. This video contains all available work so far; the employer outcome is separate.</p>}<p className="subtle">One application video · {Math.round(timeline.duration)} seconds · Updated {new Date(timeline.recordedAt).toLocaleString()}. Later work is added automatically. This video does not by itself prove employer submission. Private sign-in windows and time spent waiting for your answers are excluded.</p></>}
  <div className="application-overview-actions"><button type="button" className="button quiet" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={15}/>Refresh video</button></div>
  <p className="subtle">Recordings may contain CV and profile information entered in the form. They stay private until you permanently delete the application or your account.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
