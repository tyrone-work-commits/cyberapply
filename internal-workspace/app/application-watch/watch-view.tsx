"use client";
import {useEffect,useRef,useState} from 'react';
import '../workspace-header.css';
import {createPortal} from 'react-dom';
import {ArrowLeft,Video,LockKeyhole,X} from 'lucide-react';
type Info={active:boolean;status:string;title:string;company:string;message:string};
type Manifest={streamId:string;mimeCodec:string;oldest:number;latest:number;at:number};
export default function AgentWatch({requestId,embedded=false,onClose}:{requestId:string;embedded?:boolean;onClose?:()=>void}){
 const pausedByUser=useRef(false),video=useRef<HTMLVideoElement>(null),panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
 const [info,setInfo]=useState<Info|null>(null),[message,setMessage]=useState('Connecting to your private live video…'),[phase,setPhase]=useState('waiting'),[mobile,setMobile]=useState(false);
 useEffect(()=>{if(!embedded)return;const query=matchMedia('(max-width:600px)'),update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[embedded]);
 useEffect(()=>{
  if(!mobile)return;const previous=document.activeElement as HTMLElement|null,bodyOverflow=document.body.style.overflow,shell=document.querySelector<HTMLElement>('.app-shell'),wasInert=shell?.inert;
  document.body.style.overflow='hidden';if(shell)shell.inert=true;close.current?.focus();
  return()=>{document.body.style.overflow=bodyOverflow;if(shell)shell.inert=!!wasInert;(document.getElementById('watch-live-'+requestId)||previous)?.focus();};
 },[mobile]);
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,renewed=0,active=true,status='',stream='',cursor=-1,objectUrl='',source:MediaSource|undefined,buffer:SourceBuffer|undefined,controller:AbortController|undefined;
  const node=video.current;if(!node)return;const element:HTMLVideoElement=node;
  const base='/api/applications/watch?requestId='+encodeURIComponent(requestId);
  function reset(){pausedByUser.current=false;element!.pause();element!.removeAttribute('src');element!.load();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl='';source=undefined;buffer=undefined;stream='';cursor=-1;if(!disposed)setPhase('waiting');}
  async function binary(part:string,manifest:Manifest,sequence?:number){
   const r=await fetch(base+'&part='+part+'&stream='+encodeURIComponent(manifest.streamId)+(sequence===undefined?'':'&seq='+sequence),{cache:'no-store',signal:controller?.signal});
   if(r.status===204)return null;if(!r.ok||!r.headers.get('content-type')?.startsWith('video/mp4'))throw Error('The private video connection changed. Reconnecting…');
   const data=await r.arrayBuffer();if(data.byteLength>500000)throw Error('The video segment exceeded its limit.');return data;
  }
  async function update(operation:()=>void){
   const target=buffer;if(!target)throw Error('Video player is not ready.');
   await new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>done(Error('The video decoder timed out.')),7000);
    const ended=()=>done(),failed=()=>done(Error('The video decoder could not play this stream.'));
    function done(error?:Error){clearTimeout(timeout);target!.removeEventListener('updateend',ended);target!.removeEventListener('error',failed);error?reject(error):resolve();}
    target.addEventListener('updateend',ended,{once:true});target.addEventListener('error',failed,{once:true});try{operation();}catch(error){done(error as Error);}
   });
  }
  async function begin(manifest:Manifest){
   reset();const Constructor=window.MediaSource||(window as unknown as {ManagedMediaSource?:typeof MediaSource}).ManagedMediaSource;
   if(!Constructor||!Constructor.isTypeSupported(manifest.mimeCodec))throw Error('This browser does not support the live H.264 video player. Use an updated browser with H.264 media-stream support.');
   const media=new Constructor();source=media;
   const opened=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('The video player did not open.')),7000);media.addEventListener('sourceopen',()=>{clearTimeout(timeout);resolve();},{once:true});});
   objectUrl=URL.createObjectURL(media);element!.disableRemotePlayback=true;element!.src=objectUrl;await opened;if(disposed)return;
   buffer=media.addSourceBuffer(manifest.mimeCodec);const init=await binary('init',manifest);if(!init)throw Error('Waiting for the current video session.');await update(()=>buffer!.appendBuffer(init));stream=manifest.streamId;cursor=Math.max(manifest.oldest,manifest.latest-1)-1;
  }
  async function poll(){
   if(disposed)return;
   if(document.visibilityState==='hidden'){reset();renewed=0;timer=setTimeout(poll,1000);return;}
   if(pausedByUser.current){setMessage('Video paused; your application continues.');timer=setTimeout(poll,500);return;}
   controller=new AbortController();const signal=controller.signal,deadline=setTimeout(()=>controller?.abort(),12000);
   try{
    if(Date.now()-renewed>6000){
     const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal}),p=await r.json() as Info&{error?:string};if(!r.ok)throw Error(p.error||'The private live view is unavailable.');
     if(disposed)return;setInfo(p);active=p.active;status=p.status;renewed=Date.now();if(!stream)setMessage(p.message);
    }
    if(!active){reset();setPhase('ended');return;}
    if(status==='processing'){
     const r=await fetch(base,{cache:'no-store',signal});
     if(r.status===204){reset();setMessage('Waiting for live video. Keep the updated background agent running on your computer.');}
     else{
      if(!r.ok)throw Error('The live video connection is unavailable.');const manifest=await r.json() as Manifest;if(disposed)return;
      if(manifest.latest>=0){
       if(stream!==manifest.streamId||cursor<manifest.oldest-1||manifest.latest-cursor>3||element.error)await begin(manifest);
       for(let count=0;count<3&&cursor<manifest.latest&&!disposed;count++){
        const next=cursor+1,data=await binary('segment',manifest,next);if(!data)break;await update(()=>buffer!.appendBuffer(data));cursor=next;
        if(element.buffered.length){const start=element.buffered.start(0),end=element.buffered.end(element.buffered.length-1);if(element.currentTime<start||element.currentTime<end-3)element.currentTime=Math.max(start,end-1.25);if(!pausedByUser.current)void element.play().catch(()=>setMessage('Press Play to watch the live video.'));}
       }
       if(element.currentTime>12&&element.buffered.length&&element.buffered.start(0)<element.currentTime-8)await update(()=>buffer!.remove(0,element.currentTime-5));
      }
     }
    }
   }catch(error){if(!disposed){reset();setMessage((error as Error).name==='AbortError'?'Live video timed out. Reconnecting; your application is unchanged.':(error as Error).message);}}
   finally{clearTimeout(deadline);}
   if(!disposed)timer=setTimeout(poll,500);
  }
  void poll();return()=>{disposed=true;controller?.abort();if(timer)clearTimeout(timer);reset();};
 },[requestId,mobile]);
 function keyboard(event:React.KeyboardEvent){
  if(event.key==='Escape'&&onClose){event.preventDefault();onClose();}
  if(mobile&&event.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button,a[href],video[controls]');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
 }
 const content=<section ref={panel} className={embedded?'application-live-view'+(mobile?' mobile-live-video':''):'agent-watch-page'} role={mobile?'dialog':'region'} aria-modal={mobile||undefined} aria-label="Live application agent video" onKeyDown={keyboard}>
  <header className="agent-watch-header signed-in-page-header">{!embedded&&<a className="brand" href="/workspace">CyberApply</a>}<strong><Video size={19}/>Live agent video</strong>{onClose?<button ref={close} type="button" className="button quiet" onClick={onClose}><X size={17}/>{mobile?'Close':'Hide'}</button>:<a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a>}</header>
  <div className="agent-watch-intro"><h2>{info?.title||'Your application'}{info?.company?' · '+info.company:''}</h2><p role="status">{phase==='live'?'Live video from the browser filling your application.':message}</p><p className="subtle"><LockKeyhole size={15}/>Private and read-only. Watching never queues, retries or submits an application.</p></div>
  <div className="agent-watch-screen" aria-label="Live browser video"><video ref={video} autoPlay muted playsInline controls controlsList="nodownload noplaybackrate" disableRemotePlayback onPlay={()=>{pausedByUser.current=false;}} onPause={()=>{if(video.current?.getAttribute('src')){pausedByUser.current=true;setPhase('paused');setMessage('Video paused; your application continues.');}}} onPlaying={()=>setPhase('live')} onWaiting={()=>setMessage('Buffering live video…')}/>{phase!=='live'&&phase!=='paused'&&<div className="agent-watch-wait"><Video size={32}/><h3>{phase==='ended'?'Agent session ended':info?.status==='queued'?'Waiting for the agent':'Connecting to live video'}</h3><p>{phase==='ended'?'This application is paused or finished. Watching does not restart it.':'An H.264 video stream will appear while the agent works.'}</p></div>}</div>
  <p className="subtle">Screen video only — no microphone, audio or remote control. A short connection delay is normal. Hide or close to stop watching. Live playback uses a short private buffer. New agent runs also save a private recording for replay.</p>
 </section>;
 return mobile?createPortal(content,document.body):content;
}
