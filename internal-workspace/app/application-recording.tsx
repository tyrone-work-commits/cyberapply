"use client";
import {ApplicationBrowserButton} from './application-browser-button';
import {useEffect,useRef,useState} from 'react';
import './workspace-header.css';
import {createPortal} from 'react-dom';
import {ArrowLeft,Download,ExternalLink,Film,LockKeyhole,RefreshCw,X} from 'lucide-react';
import {dvrTarget,resumeVideo} from '@/lib/video-dvr';
import {applicationRecordingTimeline,recordingPollDelay,recordingViewMessage,liveVideoPhase,type LiveVideoInfo,type RecordingSnapshot} from '@/lib/recording-view-state';
export function ApplicationRecording({requestId,onClose,embedded=false,dvr=false,liveInfo}:{requestId:string;onClose?:()=>void;embedded?:boolean;dvr?:boolean;liveInfo?:LiveVideoInfo|null}){
 const [snapshot,setSnapshot]=useState<RecordingSnapshot|null>(null),[message,setMessage]=useState('Loading your private application video…'),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false),[refresh,setRefresh]=useState(0);
 const video=useRef<HTMLVideoElement>(null),blob=useRef(''),resume=useRef({requestId:'',time:0,paused:false});
 const [media,setMedia]=useState({requestId:'',url:'',signature:''}),[preparing,setPreparing]=useState(false),[playbackError,setPlaybackError]=useState(''),[mediaRetry,setMediaRetry]=useState(0);
 const follow=useRef(dvr),swapping=useRef(false),seekTarget=useRef<number|null>(null),pendingJump=useRef(false),partCache=useRef(new Map<string,ArrayBuffer>());
 const [dvrMode,setDvrMode]=useState<'live'|'history'>(dvr?'live':'history'),[atEnd,setAtEnd]=useState(false);
 const close=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),generation=useRef(0);
 const base='/api/applications/recordings?requestId='+encodeURIComponent(requestId);
 useEffect(()=>{setSnapshot(null);partCache.current.clear();},[requestId]);
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
    setSnapshot(p);setMessage(recordingViewMessage(p));delay=recordingPollDelay(p,dvr);
   }catch(error){if(generation.current===id){setMessage((error as Error).name==='AbortError'?'Recording refresh timed out. Retrying automatically.':(error as Error).message);delay=15000;}}
   finally{clearTimeout(timeout);loading=false;if(generation.current===id){setBusy(false);if(!document.hidden)timer=setTimeout(load,delay);}}
  }
  function visible(){if(document.hidden){if(timer)clearTimeout(timer);}else void load();}
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);void load();
  return()=>{generation.current++;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[requestId,refresh,base,dvr]);
 let timeline:ReturnType<typeof applicationRecordingTimeline>=null,timelineError='';
 try{if(snapshot)timeline=applicationRecordingTimeline(snapshot);}catch(error){timelineError=(error as Error).message;}
 const signature=JSON.stringify(timeline?.parts.map(part=>[part.attempt,part.part,part.duration])||[]);
 const canDownload=!!timeline&&!timelineError&&!preparing&&media.requestId===requestId&&media.signature===signature&&!!media.url;
 const downloadName='CyberApply-'+([snapshot?.employer.company,snapshot?.employer.title].filter(Boolean).join('-')||requestId).replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,130)+'.mp4';
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
    if(ordered.length===1&&!dvr)source=url(ordered[0]);
    else{
     if(timeline!.size>48_000_000)throw Error('This recording exceeds the playback limit.');
     const {combineRecordingParts}=await import('@/lib/continuous-recording'),buffers:ArrayBuffer[]=[];let size=0;
     const cacheKey=(part:typeof ordered[number])=>JSON.stringify([requestId,part.attempt,part.part,part.duration,part.size??null]),validKeys=new Set(ordered.map(cacheKey));
     for(const key of partCache.current.keys())if(!validKeys.has(key))partCache.current.delete(key);
     for(const part of ordered){
      const key=cacheKey(part);let data=partCache.current.get(key);
      if(!data){
       const response=await fetch(url(part),{cache:'no-store',signal:controller.signal});
       if(!response.ok||!response.headers.get('content-type')?.startsWith('video/mp4'))throw Error('The private recording could not be loaded. Refresh recordings to try again.');
       data=await response.arrayBuffer();if(disposed)return;
       if(data.byteLength>48_000_000)throw Error('This recording exceeds the playback limit.');
      }
      size+=data.byteLength;if(size>48_000_000)throw Error('This recording exceeds the playback limit.');partCache.current.set(key,data);buffers.push(data);
     }
     if(disposed)return;
     source=URL.createObjectURL(new Blob([buffers.length===1?buffers[0]:combineRecordingParts(buffers)],{type:'video/mp4'}));
    }
    if(disposed){if(source.startsWith('blob:'))URL.revokeObjectURL(source);return;}
    const node=video.current,hadMedia=media.requestId===requestId&&!!media.url;resume.current={requestId,...resumeVideo({time:node?.currentTime||0,paused:!!node?.paused,ended:!!node?.ended,hadMedia},timeline!.duration,dvr&&follow.current)};swapping.current=true;
    const previous=blob.current;blob.current=source.startsWith('blob:')?source:'';setMedia({requestId,url:source,signature});if(previous)URL.revokeObjectURL(previous);
   }catch(error){if(!controller.signal.aborted&&!disposed)setPlaybackError((error as Error).message);}finally{if(!disposed)setPreparing(false);}
  }
  void prepare();return()=>{disposed=true;controller.abort();};
 // Refreshing unchanged metadata must not reset playback or repeat downloads.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[requestId,signature,base,mediaRetry,dvr]);
 function jump(){
  follow.current=true;setDvrMode('live');setAtEnd(false);
  const node=video.current;if(!node||node.readyState<1){pendingJump.current=true;return;}
  pendingJump.current=false;const target=dvrTarget('live',node.duration);seekTarget.current=target;node.currentTime=target;void node.play().catch(()=>{});
 }
 function loaded(){
  const node=video.current,saved=resume.current;if(!node||saved.requestId!==requestId)return;swapping.current=false;
  if(dvr&&pendingJump.current){jump();return;}
  seekTarget.current=saved.time;node.currentTime=saved.time;setAtEnd(false);
  if(saved.paused)node.pause();else void node.play().catch(()=>{});
 }
 function seeking(){
  if(!dvr||swapping.current)return;const node=video.current;if(!node)return;
  if(seekTarget.current!==null&&Math.abs(node.currentTime-seekTarget.current)<.15)return;
  seekTarget.current=null;follow.current=false;setDvrMode('history');setAtEnd(false);
 }
 function paused(){if(dvr&&!swapping.current&&video.current?.src&&!video.current.ended){follow.current=false;setDvrMode('history');}}
 function keyboard(event:React.KeyboardEvent){if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}if(mobile&&event.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled),video[controls]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}
 const livePhase=liveVideoPhase(snapshot?.applicationStatus,liveInfo,atEnd,dvrMode==='history');
 const liveBadge=dvr&&<span className="live-control-badge" data-control={livePhase.control} role="status">{livePhase.caption}</span>;
 const content=<section ref={panel} className={onClose||embedded?'application-live-view'+(mobile?' mobile-live-video':''):'agent-watch-page'} role={mobile?'dialog':'region'} aria-modal={mobile||undefined} aria-label={dvr?"Live application DVR":"Saved application recordings"} onKeyDown={keyboard}>
  {!embedded&&<header className="agent-watch-header signed-in-page-header">{!onClose&&<a className="brand" href="/workspace">CyberApply</a>}<strong><Film size={19}/>Application recording</strong><>{onClose?<button ref={close} type="button" className="button quiet" onClick={onClose}><X size={17}/>{mobile?'Close':'Hide'}</button>:<a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a>}</></header>}
  <p className="subtle"><LockKeyhole size={15}/>Private to your account. Replaying never applies, submits or retries a job.</p>
  {snapshot&&<div className="application-detail-section"><h2>{snapshot.employer.title}</h2><p>{snapshot.employer.company}</p>{snapshot.employer.url&&<ApplicationBrowserButton url={snapshot.employer.url}/>}<p className="subtle">{snapshot.applicationStatus==='uncertain'?'Employer receipt remains unconfirmed. Do not submit again until its outcome is checked.':snapshot.applicationStatus==='applied'?'Employer confirmation is recorded in Applications.':'See Applications for the employer outcome.'}</p></div>}
  {dvr&&<div className="watch-process-modes" role="group" aria-label="Live timeline controls"><button type="button" className="button quiet" aria-pressed={dvrMode==='live'} onClick={jump}>Go live</button><span className="dvr-playback-status" role="status">{livePhase.label}</span></div>}
  {dvr&&<p className="subtle">Drag the video timeline to rewind. New uploaded footage extends this same player without skipping unwatched work. Go live jumps to the newest available footage; playback has an upload buffer.</p>}
  {message&&<p role="status">{message}</p>}
  {timelineError&&<p role="alert">{timelineError}</p>}
  {timeline&&<>{preparing&&<p role="status">Updating your continuous application video…</p>}{playbackError&&<p role="alert">{playbackError}</p>}<div className="agent-watch-screen">{liveBadge}<video ref={video} src={media.requestId===requestId?media.url:undefined} onLoadedMetadata={loaded} onSeeking={seeking} onSeeked={()=>{seekTarget.current=null;}} onPause={paused} onEnded={()=>setAtEnd(true)} autoPlay={!resume.current.paused} muted controls playsInline preload="auto" onError={()=>{if(!preparing)setPlaybackError('This video could not play. Refresh the video or try an updated browser.');}}/></div>{timeline.partial&&<p role="status">Some footage is missing or capture was interrupted. This video contains all available work so far; the employer outcome is separate.</p>}<p className="subtle">One application video · {Math.round(timeline.duration)} seconds · Updated {new Date(timeline.recordedAt).toLocaleString()}. Later work is added automatically. This video does not by itself prove employer submission. New runs include ordinary manual form input with control-status captions. Private sign-in, emailed-code and CAPTCHA screens are excluded and marked with a pause. Idle manual waits are shortened. Older footage may have omitted manual steps; capture limits or interruptions are reported above.</p></>}
  {dvr&&!timeline&&<div className="agent-watch-screen live-waiting-screen">{liveBadge}<p>Waiting for available footage. This viewer updates automatically.</p></div>}
  <div className="application-overview-actions">{timeline&&(canDownload?<a className="button quiet" href={media.url} download={downloadName}><Download size={15}/>Download video</a>:<button type="button" className="button quiet" disabled><Download size={15}/>Download video</button>)}<button type="button" className="button quiet" disabled={busy} onClick={()=>{setRefresh(value=>value+1);if(playbackError){partCache.current.clear();setMediaRetry(value=>value+1);}}}><RefreshCw size={15}/>Refresh video</button></div>
  {timeline&&<p className="subtle">Download saves the available footage as one MP4. Download again after later work is added to get the updated video.</p>}
  <p className="subtle">Recordings may contain CV and profile information entered in the form. Copies in CyberApply stay private until you permanently delete the application or your account. Downloaded copies remain on your device.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
