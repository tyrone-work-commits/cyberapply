"use client";
import {useEffect,useState} from 'react';
import {ArrowLeft,Eye,LockKeyhole} from 'lucide-react';
type Info={active:boolean;status:string;title:string;company:string;message:string};
export default function AgentWatch({requestId}:{requestId:string}){
 const [info,setInfo]=useState<Info|null>(null),[image,setImage]=useState(''),[message,setMessage]=useState('Connecting to your private agent view…'),[observed,setObserved]=useState('');
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,url='',renewed=0,active=true,status='',controller:AbortController|undefined;
  function clear(){if(url)URL.revokeObjectURL(url);url='';if(!disposed){setImage('');setObserved('');}}
  async function poll(){
   if(disposed)return;
   if(document.visibilityState==='hidden'){clear();timer=setTimeout(poll,1500);return;}
   controller=new AbortController();const signal=controller.signal,timeout=setTimeout(()=>controller?.abort(),10000);
   try{
    if(Date.now()-renewed>6000){
     const r=await fetch('/api/applications/watch?requestId='+encodeURIComponent(requestId),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal});
     const p=await r.json() as Info&{error?:string};if(!r.ok)throw Error(p.error||'The private viewer is unavailable.');
     if(disposed)return;setInfo(p);setMessage(p.message);active=p.active;status=p.status;renewed=Date.now();
    }
    if(!active){clear();return;}
    if(status==='processing'){
     const r=await fetch('/api/applications/watch?requestId='+encodeURIComponent(requestId),{cache:'no-store',signal});
     if(r.status===204){clear();setMessage('Waiting for a fresh browser snapshot. Keep the updated background agent running on your computer.');}
     else{
      if(!r.ok||!r.headers.get('content-type')?.startsWith('image/jpeg'))throw Error('No current private snapshot is available.');
      const blob=await r.blob();if(blob.size>240000)throw Error('The snapshot exceeded the viewer limit.');if(disposed)return;
      const next=URL.createObjectURL(blob);if(url)URL.revokeObjectURL(url);url=next;setImage(next);setObserved(r.headers.get('X-Frame-Observed-At')||'');setMessage('Live snapshots from the browser filling your application.');
     }
    }else clear();
   }catch(error){if(!disposed){clear();setMessage((error as Error).name==='AbortError'?'The live view timed out. Reconnecting; your application is unchanged.':(error as Error).message||'The viewer connection stopped. This does not restart your application.');}}finally{clearTimeout(timeout);}
   if(!disposed)timer=setTimeout(poll,1500);
  }
  void poll();return()=>{disposed=true;controller?.abort();if(timer)clearTimeout(timer);if(url)URL.revokeObjectURL(url);};
 },[requestId]);
 return <main className="agent-watch-page"><header className="agent-watch-header"><a className="brand" href="/workspace">CyberApply</a><a className="button quiet" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a></header><section className="panel agent-watch-intro"><div><span className="eyebrow">PRIVATE AGENT VIEW</span><h1><Eye size={26}/>Watch your agent</h1><h2>{info?.title||'Your application'}{info?.company?' · '+info.company:''}</h2><p role="status">{message}</p></div><p className="subtle"><LockKeyhole size={15}/>Read-only, visible only to your signed-in account. Opening this view never queues, retries or submits an application.</p></section><section className="agent-watch-screen" aria-label="Agent browser snapshots">{image?<img src={image} alt="Current browser view of your application agent filling the employer form"/>:<div className="agent-watch-wait"><Eye size={38}/><h2>{info&&!info.active?'Agent session ended':'Waiting for the agent’s browser'}</h2><p>{info?.status==='queued'?'Your request is queued. This view will connect when the agent starts.':'Current snapshots appear here while the agent works.'}</p></div>}</section>{observed&&<p className="subtle">Snapshot received {new Date(Number(observed)).toLocaleTimeString()}. Updates about every two seconds while this tab is visible.</p>}<p className="subtle">Snapshots can show the CV and profile details being entered for this job. Only the latest image is kept; no video recording is created. Access expires shortly after you leave this tab, and the worker clears the image when it finishes. Login and employer verification still need your direct involvement.</p></main>;
}
