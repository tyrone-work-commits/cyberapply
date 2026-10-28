"use client";
import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Download, LogOut, ShieldCheck, Trash2, UserRound, LoaderCircle } from 'lucide-react';
import { EntryBrand } from '../entry-screen';
import { GuidedTour, tourSteps } from '../guided-tour';

type AccountStatus={email:string;revision:number;deleting:boolean;files:number;jobs:number;applications:number};

export default function AccountPanel({email,signOutHref}:{email:string;signOutHref:string}){
  const [status,setStatus]=useState<AccountStatus|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [tourStep,setTourStep]=useState<number|null>(null);
  const [tourBusy,setTourBusy]=useState(false);
  const [tourError,setTourError]=useState('');
  useEffect(()=>{const requested=Number(new URLSearchParams(window.location.search).get('tour'));if(Number.isInteger(requested)&&requested>=0&&requested<tourSteps.length&&tourSteps[requested].area==='account')setTourStep(requested);},[]);
  async function finishTour(){
    if(tourBusy)return;
    setTourBusy(true);setTourError('');
    try{
      const response=await fetch('/api/workspace',{cache:'no-store'});
      const packet=await response.json() as {revision:number;state:{tutorialCompletedAt?:string};error?:string};
      if(!response.ok)throw new Error(packet.error||'The tour could not be saved.');
      if(!packet.state.tutorialCompletedAt){
        const saved=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:packet.revision,action:{type:'complete_tutorial'}})});
        if(!saved.ok)throw new Error('The tour could not be saved. Please try again.');
      }
      window.location.assign('/workspace');
    }catch(failure){setTourError((failure as Error).message);setTourBusy(false);}
  }
  function previousTourStep(){if(tourStep===null)return;const previous=tourStep-1;if(tourSteps[previous]?.area==='account')setTourStep(previous);else window.location.assign(`/workspace?tour=1&step=${previous}`);}
  async function refresh(){
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/account',{cache:'no-store'});
      const data=await response.json() as AccountStatus&{error?:string};
      if(!response.ok)throw new Error(data.error||'Account details could not be loaded.');
      setStatus(data);
    }catch(failure){setError((failure as Error).message);}finally{setLoading(false);}
  }
  useEffect(()=>{
    let active=true;
    void fetch('/api/account',{cache:'no-store'}).then(async response=>{
      const data=await response.json() as AccountStatus&{error?:string};
      if(!response.ok)throw new Error(data.error||'Account details could not be loaded.');
      if(active)setStatus(data);
    }).catch(failure=>{if(active)setError((failure as Error).message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  async function removeAccount(){
    if(!status||busy||confirmation!=='DELETE CYBERAPPLY')return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:status.revision,confirmation})});
      const data=await response.json() as {deleted?:boolean;error?:string};
      if(!response.ok||!data.deleted)throw new Error(data.error||'Account deletion could not be completed.');
      window.location.assign(signOutHref);
    }catch(failure){await refresh();setError((failure as Error).message);}finally{setBusy(false);}
  }
  return <div className="entry-shell account-shell">
    <header className="entry-header"><EntryBrand href="/workspace" label="CyberApply — go to Explore"/><a className="entry-back" href="/workspace"><ArrowLeft size={16}/>Back to workspace</a></header>
    <main className="account-main">
      <div className="account-intro"><span className="eyebrow">YOUR ACCOUNT</span><h1>Account settings</h1><p>Manage your CyberApply profile, sign out, or remove your private workspace.</p></div>
      <section className="panel account-section"><div className="account-section-heading"><UserRound size={21}/><div><h2>Signed in with ChatGPT</h2><p>{email}</p></div></div><div className="account-actions"><a className="button quiet" href="/onboarding">Edit account profile</a><a className="button quiet" href="/api/export"><Download size={16}/>Export my records</a></div></section>
      <section className="panel account-section"><div className="account-section-heading"><BookOpen size={21}/><div><h2>App tutorial</h2><p>Walk through Explore, Saved, Applications, Inbox, CV review, Activity and Settings again.</p></div></div><a className="button quiet" href="/workspace?tour=1"><BookOpen size={16}/>Replay tutorial</a></section>
      <section className="panel account-section"><div className="account-section-heading"><LogOut size={21}/><div><h2>Sign out</h2><p>End your CyberApply Site session on this browser. Your saved work stays here for next time.</p></div></div><a className="button quiet" href={signOutHref} target="_top"><LogOut size={16}/>Sign out</a></section>
      <section className="panel account-section account-danger"><div className="account-section-heading"><Trash2 size={21}/><div><h2>Delete CyberApply account and data</h2><p>This permanently removes your CyberApply profile, CV review and original files, saved jobs, application requests, drafts, activity, and version history. It does not delete your ChatGPT account or withdraw any application you made outside CyberApply.</p></div></div>
        {loading?<p className="subtle"><LoaderCircle size={15} className="spin"/> Checking your saved records…</p>:status&&<p className="subtle">{status.deleting?'A previous deletion was interrupted. Your workspace is locked until you retry.':`Saved here: ${status.files} CV file${status.files===1?'':'s'}, ${status.jobs} job${status.jobs===1?'':'s'}, ${status.applications} Apply request${status.applications===1?'':'s'}.`}</p>}
        <label className="account-confirm" htmlFor="account-delete-confirm">Type <strong>DELETE CYBERAPPLY</strong> to confirm<input id="account-delete-confirm" type="text" autoComplete="off" spellCheck={false} value={confirmation} onChange={event=>setConfirmation(event.target.value)} placeholder="DELETE CYBERAPPLY"/></label>
        <button className="button account-delete-button" type="button" disabled={loading||busy||!status||confirmation!=='DELETE CYBERAPPLY'} onClick={()=>void removeAccount()}>{busy?<LoaderCircle size={17} className="spin"/>:<Trash2 size={17}/>} {status?.deleting?'Retry account deletion':'Delete my CyberApply account'}</button>
        <p className="subtle">You can create a new, empty CyberApply workspace later by signing in again. Export anything you need before deleting.</p>
      </section>
      {error&&<div className="notice error" role="alert"><strong>Something needs your attention</strong><span>{error}</span><button className="button quiet" type="button" onClick={()=>void refresh()}>Reload account</button></div>}
    </main><footer className="entry-footer"><span><ShieldCheck size={15}/> CyberApply · Covenda internal</span><span>Private to your ChatGPT identity</span></footer>
    {tourStep!==null&&<GuidedTour step={tourStep} busy={tourBusy} error={tourError} onBack={previousTourStep} onNext={()=>tourStep===tourSteps.length-1?void finishTour():setTourStep(tourStep+1)} onExit={()=>void finishTour()}/>}
  </div>;
}
