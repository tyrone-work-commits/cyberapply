"use client";
import {useEffect,useRef,useState} from 'react';
import './workspace-header.css';
import {createPortal} from 'react-dom';
import {ArrowLeft,Film,LockKeyhole,RefreshCw,X} from 'lucide-react';
type VideoPart={part:number|null;duration:number};
type Recording={attempt:string;duration:number;startedAt:string;recordedAt:string;partial:boolean;reason:string;size:number;parts?:VideoPart[]};
type CaptureStatus={state:string;code:string;parts:number;partial:boolean;at:string;attempt:string};
export function ApplicationRecording({requestId,onClose}:{requestId:string;onClose?:()=>void}){
 const [items,setItems]=useState<Recording[]>([]),[attempt,setAttempt]=useState(''),[capture,setCapture]=useState<CaptureStatus|null>(null),[cursor,setCursor]=useState<string|null>(null),[message,setMessage]=useState('Loading your private recordings…'),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false),[refresh,setRefresh]=useState(0);
 const video=useRef<HTMLVideoElement>(null),blob=useRef(''),resume=useRef({attempt:'',time:0,paused:false});
 const [media,setMedia]=useState({attempt:'',url:''}),[preparing,setPreparing]=useState(false),[playbackError,setPlaybackError]=useState('');
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
   const r=await fetch(base,{cache:'no-store',signal:controller.signal}),p=await r.json() as {items:Recording[];nextCursor:string|null;status:CaptureStatus|null;applicationStatus:string;error?:string};if(!r.ok)throw Error(p.error||'Recordings could not be loaded.');if(generation.current!==id)return;
   setItems(p.items);setCursor(p.nextCursor);setAttempt(current=>p.items.some(item=>item.attempt===current)?current:p.items[0]?.attempt||'');
   if(p.status?.state==='capturing'&&Date.now()-Date.parse(p.status.at)>45000&&!['queued','processing'].includes(p.applicationStatus))p.status={...p.status,state:'interrupted',code:'runner_interrupted',partial:true};
   setCapture(p.status);
   const pending=p.status&&['capturing','upload_pending'].includes(p.status.state);
   let text='';
   if(p.status?.state==='upload_pending')text='The recording is saved on your computer and waiting to upload. Keep the background agent connected; video-only retries do not apply again.';
   else if(p.status?.state==='capturing')text='Recording in progress. Available footage plays as one continuous video while the agent works.';
   else if(p.status?.state==='interrupted')text='The runner was interrupted. Any saved footage below remains available; the application outcome is separate.';
   else if(p.status?.state==='saved')text='Recording saved. You can replay it below.';
   else if(p.status?.state==='failed')text=p.status.code==='no_frames'?'No browser frames were captured for this run. No recording is available.':'Recording capture stopped. Any saved footage below remains playable.';
   if(!p.items.length&&!text)text=p.applicationStatus==='uncertain'?'No recording was saved for this interrupted run. Its employer outcome remains unverified. Missing earlier footage cannot be recreated.':'No saved recording yet. New runs save footage as the agent works. Missing earlier footage cannot be recreated.';
   if(p.status?.code==='recording_limit')text+=' The recording reached its ten-minute or size limit; saved footage is partial.';
   if(p.status?.code==='capture_interrupted')text+=' Capture was interrupted; saved footage is partial.';
   setMessage(text);
   if((pending||!p.items.length)&&checks++<360)timer=setTimeout(load,5000);
  }catch(error){if(!controller.signal.aborted&&generation.current===id)setMessage((error as Error).message);}finally{if(generation.current===id)setBusy(false);}}
  void load();return()=>{generation.current++;controller.abort();if(timer)clearTimeout(timer);};
 },[requestId,refresh,base]);
 async function older(){if(!cursor||busy)return;setBusy(true);try{const r=await fetch(base+'&cursor='+encodeURIComponent(cursor),{cache:'no-store'}),p=await r.json() as {items:Recording[];nextCursor:string|null;error?:string};if(!r.ok)throw Error(p.error||'Older recordings could not be loaded.');setItems(current=>[...current,...p.items.filter(item=>!current.some(old=>old.attempt===item.attempt))]);setCursor(p.nextCursor);}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
 const chosen=items.find(item=>item.attempt===attempt);
 const parts=chosen?.parts?.length?chosen.parts:[{part:null,duration:chosen?.duration||0}];
 const signature=JSON.stringify(parts.map(part=>[part.part,part.duration]));
 useEffect(()=>()=>{if(blob.current)URL.revokeObjectURL(blob.current);},[]);
 useEffect(()=>{
  const controller=new AbortController();let disposed=false;
  if(!chosen)return;
  setPlaybackError('');
  const selected=chosen.parts?.length?chosen.parts:[{part:null,duration:chosen.duration}];
  const full=selected.find(part=>part.part===null),ordered=full?[full]:[...selected].sort((a,b)=>a.part!-b.part!);
  const url=(part:number|null)=>base+'&attempt='+encodeURIComponent(chosen.attempt)+(part===null?'':'&part='+part);
  async function prepare(){
   setPreparing(true);
   try{
    let source:string;
    if(ordered.length===1)source=url(ordered[0].part);
    else{
     if(chosen!.size>48_000_000)throw Error('This recording exceeds the playback limit.');
     const {combineRecordingParts}=await import('@/lib/continuous-recording'),buffers:ArrayBuffer[]=[];let size=0;
     for(const part of ordered){
      const response=await fetch(url(part.part),{cache:'no-store',signal:controller.signal});
      if(!response.ok||!response.headers.get('content-type')?.startsWith('video/mp4'))throw Error('The private recording could not be loaded. Refresh recordings to try again.');
      const data=await response.arrayBuffer();size+=data.byteLength;if(size>48_000_000)throw Error('This recording exceeds the playback limit.');buffers.push(data);
     }
     if(disposed)return;
     source=URL.createObjectURL(new Blob([combineRecordingParts(buffers)],{type:'video/mp4'}));
    }
    if(disposed){if(source.startsWith('blob:'))URL.revokeObjectURL(source);return;}
    const node=video.current;resume.current={attempt:chosen!.attempt,time:media.attempt===chosen!.attempt?node?.currentTime||0:0,paused:media.attempt===chosen!.attempt?!!node?.paused&&!node.ended:false};
    const previous=blob.current;blob.current=source.startsWith('blob:')?source:'';setMedia({attempt:chosen!.attempt,url:source});if(previous)URL.revokeObjectURL(previous);
   }catch(error){if(!controller.signal.aborted&&!disposed)setPlaybackError((error as Error).message);}finally{if(!disposed)setPreparing(false);}
  }
  void prepare();return()=>{disposed=true;controller.abort();};
 // Refreshing unchanged metadata must not reset playback or repeat downloads.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[attempt,signature,base,refresh]);
 function loaded(){const node=video.current,saved=resume.current;if(!node||saved.attempt!==attempt)return;if(saved.time>0)node.currentTime=Math.min(saved.time,Math.max(0,node.duration-.01));if(saved.paused)node.pause();}
 function keyboard(event:React.KeyboardEvent){if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}if(mobile&&event.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button,select,video[controls]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}
 const content=<section ref={panel} className={onClose?'application-live-view'+(mobile?' mobile-live-video':''):'agent-watch-page'} role={mobile?'dialog':'region'} aria-modal={mobile||undefined} aria-label="Saved application recordings" onKeyDown={keyboard}>
  <header className="agent-watch-header signed-in-page-header">{!onClose&&<a className="brand" href="/workspace">CyberApply</a>}<strong><Film size={19}/>Application recording</strong><>{onClose?<button ref={close} type="button" className="button quiet" onClick={onClose}><X size={17}/>{mobile?'Close':'Hide'}</button>:<a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a>}</></header>
  <p className="subtle"><LockKeyhole size={15}/>Private to your account. Replaying never applies, submits or retries a job.</p>
  {message&&<p role="status">{message}</p>}
  {!!items.length&&<label>Recorded run<select value={attempt} onChange={event=>setAttempt(event.target.value)}>{items.map(item=><option value={item.attempt} key={item.attempt}>{new Date(item.startedAt).toLocaleString()} · {Math.round(item.duration)} seconds{item.partial?' · Partial recording':''}</option>)}</select></label>}
  {chosen&&<>{preparing&&<p role="status">Preparing your continuous recording…</p>}{playbackError&&<p role="alert">{playbackError}</p>}<div className="agent-watch-screen"><video ref={video} src={media.attempt===attempt?media.url:undefined} onLoadedMetadata={loaded} autoPlay muted controls playsInline preload="auto" controlsList="nodownload" onError={()=>{if(!preparing)setPlaybackError('This recording could not play. Refresh recordings or try an updated browser.');}}/></div>{(chosen.partial||capture?.attempt===attempt&&capture.partial)&&<p role="status">Partial recording: {(chosen.reason||capture?.code)==='recording_limit'?'the recording reached its time or size limit.':'capture was interrupted.'} The application’s own status is shown separately.</p>}<p className="subtle">Recorded {new Date(chosen.recordedAt).toLocaleString()}. This shows the agent’s browser activity; it does not by itself prove employer submission. Private sign-in windows are excluded.</p></>}
  <div className="application-overview-actions"><button type="button" className="button quiet" disabled={busy} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={15}/>Refresh recordings</button>{cursor&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void older()}>Load older runs</button>}</div>
  <p className="subtle">Recordings may contain CV and profile information entered in the form. They stay private until you permanently delete the application or your account.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
