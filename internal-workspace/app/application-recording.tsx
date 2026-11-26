"use client";
import {ApplicationBrowserButton} from './application-browser-button';
import {useEffect,useRef,useState} from 'react';
import './workspace-header.css';
import './application-recording.css';
import {createPortal} from 'react-dom';
import {ArrowLeft,Download,ExternalLink,Film,LockKeyhole,RefreshCw,X} from 'lucide-react';
import {dvrTarget} from '@/lib/video-dvr';
import {RecordingStream} from '@/lib/recording-stream';
import {recordingSnapshot} from '@/lib/recording-snapshot';
import {applicationRecordingTimeline,recordingAvailability,recordingPollDelay,recordingViewMessage,liveVideoPhase,type LiveVideoInfo,type RecordingSnapshot} from '@/lib/recording-view-state';
export function ApplicationRecording({requestId,onClose,embedded=false,dvr=false,liveInfo,library=false}:{library?:boolean;requestId:string;onClose?:()=>void;embedded?:boolean;dvr?:boolean;liveInfo?:LiveVideoInfo|null}){
 const [snapshot,setSnapshot]=useState<RecordingSnapshot|null>(null),[message,setMessage]=useState('Loading your private application video…'),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false),[refresh,setRefresh]=useState(0);
 const video=useRef<HTMLVideoElement>(null),resume=useRef({requestId:'',time:0,paused:false});
 const [media,setMedia]=useState({requestId:'',url:'',signature:'',preview:false,offset:0}),[preparing,setPreparing]=useState(false),[playbackError,setPlaybackError]=useState(''),[mediaRetry,setMediaRetry]=useState(0);
 const follow=useRef(dvr),swapping=useRef(false),seekTarget=useRef<number|null>(null),pendingJump=useRef(false),stream=useRef<RecordingStream|null>(null);
 const [dvrMode,setDvrMode]=useState<'live'|'history'>(dvr?'live':'history'),[atEnd,setAtEnd]=useState(false);
 const close=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null),generation=useRef(0),snapshotRequest=useRef(''),retries=useRef(0);
 const base=(library?'/api/private-videos/media':'/api/applications/recordings')+'?requestId='+encodeURIComponent(requestId);
 useEffect(()=>{setSnapshot(null);retries.current=0;return()=>{stream.current?.close();stream.current=null;};},[requestId]);
 useEffect(()=>{if(!onClose)return;const query=matchMedia('(max-width:600px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[onClose]);
 useEffect(()=>{
  if(!mobile)return;const overflow=document.body.style.overflow,shell=document.querySelector<HTMLElement>('.app-shell'),inert=shell?.inert;
  document.body.style.overflow='hidden';if(shell)shell.inert=true;close.current?.focus();
  return()=>{document.body.style.overflow=overflow;if(shell)shell.inert=!!inert;document.getElementById('watch-recording-'+requestId)?.focus();};
 },[mobile,requestId]);
 useEffect(()=>{
  const id=++generation.current;let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,loading=false,delay=5000;
  async function load(){
   if(document.hidden||loading)return;if(timer)clearTimeout(timer);loading=true;setBusy(true);controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),30000);
   try{
    const p=await recordingSnapshot(base,controller.signal);if(generation.current!==id)return;
    snapshotRequest.current=requestId;setSnapshot(p);setMessage(library?(p.items.length?'Showing all uploaded footage so far. A running application may add more video; downloading saves the footage currently available.':'No saved footage is available for this video yet.'):dvr||recordingAvailability(p).ready?recordingViewMessage(p):'');delay=recordingPollDelay(p,dvr);
   }catch(error){if(generation.current===id){setMessage((error as Error).name==='AbortError'?'Video connection is slow. Available footage stays playable; reconnecting automatically.':(error as Error).message);delay=3000;}}
   finally{clearTimeout(timeout);loading=false;if(generation.current===id){setBusy(false);if(!document.hidden)timer=setTimeout(load,delay);}}
  }
  function visible(){if(document.hidden){if(timer)clearTimeout(timer);}else void load();}
  document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);void load();
  return()=>{generation.current++;controller?.abort();if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[requestId,refresh,base,dvr]);
 const currentSnapshot=snapshotRequest.current===requestId?snapshot:null;
 const availability=recordingAvailability(currentSnapshot),showFootage=dvr||library||availability.ready;
 let timeline:ReturnType<typeof applicationRecordingTimeline>=null,timelineError='';
 try{if(currentSnapshot&&showFootage)timeline=applicationRecordingTimeline(currentSnapshot);}catch(error){timelineError=(error as Error).message;}
 const signature=JSON.stringify(timeline?.parts.map(part=>[part.attempt,part.part,part.duration,part.size])||[]);
 const canDownload=!!timeline&&!timelineError&&(library||availability.ready);
 const downloadName='CyberApply-'+([snapshot?.employer.company,snapshot?.employer.title].filter(Boolean).join('-')||requestId).replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,130)+'.mp4';
 function partsForStream(){
  let start=0;return (timeline?.parts||[]).map(part=>{const row={url:base+'&attempt='+encodeURIComponent(part.attempt)+(part.part===null?'':'&part='+part.part),start,duration:part.duration};start+=part.duration;return row;});
 }
 const hasTimeline=!!timeline;
 useEffect(()=>{
  if(!hasTimeline){setPreparing(false);setMedia({requestId:'',url:'',signature:'',preview:false,offset:0});return;}
  const node=video.current;if(!node)return;
  if(typeof MediaSource==='undefined'){setPlaybackError('Use an updated browser to watch this video, or download the finished recording.');return;}
  setPreparing(true);setPlaybackError('');swapping.current=true;
  resume.current={requestId,time:dvr&&follow.current?dvrTarget('live',timeline!.duration):0,paused:false};
  const player=new RecordingStream(node,message=>{setPreparing(false);setPlaybackError(message);});stream.current=player;
  player.update(partsForStream(),timeline!.duration);
  setMedia({requestId,url:player.url,signature:'stream',preview:false,offset:0});
  return()=>{player.close();if(stream.current===player)stream.current=null;};
 // The existing MediaSource stays alive as new checkpoints extend the timeline.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[requestId,hasTimeline,mediaRetry,dvr]);
 useEffect(()=>{if(timeline)stream.current?.update(partsForStream(),timeline.duration);},[signature]);
 useEffect(()=>{
  if(!playbackError||retries.current>=2)return;
  const timer=setTimeout(()=>{retries.current++;setMediaRetry(value=>value+1);},retries.current?5000:2000);
  return()=>clearTimeout(timer);
 },[playbackError,mediaRetry]);
 function jump(){
  follow.current=true;setDvrMode('live');setAtEnd(false);
  const node=video.current;if(!node||node.readyState<1){pendingJump.current=true;return;}
  pendingJump.current=false;const target=dvrTarget('live',node.duration);seekTarget.current=target;node.currentTime=target;void node.play().catch(()=>{});
 }
 function loaded(){
  const node=video.current,saved=resume.current;if(!node||saved.requestId!==requestId)return;swapping.current=false;setPreparing(false);
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
  {snapshot&&<div className="application-detail-section"><h2>{snapshot.employer.title}</h2><p>{snapshot.employer.company}</p>{snapshot.employer.url&&<ApplicationBrowserButton url={snapshot.employer.url}/>}<p className="subtle">{snapshot.applicationStatus==='archived'?'The application record was deleted. Its private uploaded footage is retained here.':snapshot.applicationStatus==='uncertain'?'Employer receipt remains unconfirmed. Do not submit again until its outcome is checked.':snapshot.applicationStatus==='applied'?'Employer confirmation is recorded in Applications.':'See Applications for the employer outcome.'}</p></div>}
  {dvr&&<div className="watch-process-modes" role="group" aria-label="Live timeline controls"><button type="button" className="button quiet" aria-pressed={dvrMode==='live'} onClick={jump}>Go live</button><span className="dvr-playback-status" role="status">{livePhase.label}</span></div>}
  {dvr&&<p className="subtle">Drag the video timeline to rewind. New uploaded footage extends this same player without skipping unwatched work. Go live jumps to the newest available footage; playback has an upload buffer.</p>}
  {!library&&!dvr&&!availability.ready&&<div className="agent-watch-screen recording-process-pending" role="status"><Film size={32} aria-hidden="true"/><h3>{availability.heading}</h3><p>{availability.message}</p></div>}
  {message&&<p role="status">{message}</p>}
  {!showFootage&&currentSnapshot&&<a className="button quiet" href={'/application-watch?request='+encodeURIComponent(requestId)} target="_blank" rel="noopener noreferrer" title="Watch live (opens in a new tab)">Watch live<ExternalLink size={13}/><span className="sr-only"> (opens in a new tab)</span></a>}
  {timelineError&&<p role="alert">{timelineError}</p>}
  {timeline&&<>{preparing&&<p role="status">{media.preview?'Showing the newest available footage while the full rewindable timeline loads…':'Updating your continuous application video…'}</p>}{playbackError&&<p role="alert">{playbackError}</p>}<div className="agent-watch-screen">{liveBadge}<video ref={video} src={media.requestId===requestId?media.url:undefined} onLoadedMetadata={loaded} onSeeking={seeking} onSeeked={()=>{seekTarget.current=null;}} onPause={paused} onEnded={()=>setAtEnd(true)} autoPlay={!resume.current.paused} muted controls playsInline preload="auto" onError={()=>{if(!preparing)setPlaybackError('This video could not play. Refresh the video or try an updated browser.');}}/></div>{timeline.partial&&<p role="status">Some footage is missing or capture was interrupted. This video contains all available work so far; the employer outcome is separate.</p>}<p className="subtle">One application video · {Math.round(timeline.duration)} seconds · Updated {new Date(timeline.recordedAt).toLocaleString()}. Later work is added automatically. This video does not by itself prove employer submission. New runs include ordinary manual form input with control-status captions. Private sign-in, emailed-code and CAPTCHA screens are excluded and marked with a pause. Ordinary manual answers, waiting and submission remain in the same timeline. Older recordings may be partial; storage or capture interruptions are reported above.</p></>}
  {dvr&&!timeline&&<div className="agent-watch-screen live-waiting-screen">{liveBadge}<p>Waiting for available footage. This viewer updates automatically.</p></div>}
  <div className="application-overview-actions">{timeline&&(canDownload?<a className="button quiet" href={base+'&download=1'} download={downloadName}><Download size={15}/>Download video</a>:<button type="button" className="button quiet" disabled><Download size={15}/>Download video</button>)}<button type="button" className="button quiet" disabled={busy} onClick={()=>{setRefresh(value=>value+1);if(playbackError){retries.current=0;setMediaRetry(value=>value+1);}}}><RefreshCw size={15}/>Refresh video</button></div>
  {timeline&&<p className="subtle">Download saves the available footage as one MP4, without loading the entire video into browser memory.</p>}
  <p className="subtle">Recordings may contain CV and profile information entered in the form. Copies remain in Settings → Private videos after application deletion. Delete them there, or delete your CyberApply account to remove all private videos. Downloaded copies remain on your device.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
