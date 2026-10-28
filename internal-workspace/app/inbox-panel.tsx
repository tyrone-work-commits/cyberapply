"use client";
import { useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, LockKeyhole, Mail, RefreshCw } from 'lucide-react';
import type { InboxMessage } from '@/lib/job-inbox';

type InboxPacket={mailbox:string;items:InboxMessage[];checkedAt:string;scope:string};
type InboxError={error:string;status?:string;connectHref?:string};

export function InboxPanel({signedInEmail,applicationCount}:{signedInEmail:string;applicationCount:number}){
  const [data,setData]=useState<InboxPacket|null>(null);
  const [error,setError]=useState<InboxError|null>(null);
  const [loading,setLoading]=useState(true);
  async function refresh(signal?:AbortSignal){
    setLoading(true);setError(null);setData(null);
    try{
      const response=await fetch('/api/inbox',{cache:'no-store',signal});
      const result=await response.json() as InboxPacket&InboxError;
      if(!response.ok)throw result;
      if(!Array.isArray(result.items))throw {error:'The mailbox returned an unexpected response.'};
      setData(result);
    }catch(failure){if(signal?.aborted)return;setError(failure&&typeof failure==='object'&&'error'in failure?failure as InboxError:{error:'The mailbox could not be checked. Try Refresh.'});}
    finally{if(!signal?.aborted)setLoading(false);}
  }
  useEffect(()=>{const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort();},[]);
  return <section className="inbox-page" aria-label="Job application inbox">
    <div className="inbox-intro panel"><div className="inbox-intro-icon"><Mail size={22}/></div><div><h2>Application inbox</h2><p>Messages are read from the Gmail account matching your CyberApply sign-in: <strong>{signedInEmail}</strong>. Only messages linked to jobs in your Applications list appear here.</p><small><LockKeyhole size={13}/> Gmail access needs your separate permission. CyberApply does not save message contents or change your mail.</small></div><button className="button quiet" type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Refresh application inbox"><RefreshCw size={16}/>Refresh</button></div>
    {error&&<div className="notice error" role="alert"><strong>Inbox unavailable</strong><span>{error.error}</span>{error.status==='reauthentication_required'&&error.connectHref&&<a className="button quiet" href={error.connectHref} target="_top">Connect Gmail</a>}</div>}
    {loading&&<div className="loading" role="status"><LoaderCircle className="spin"/><p>Checking application messages…</p></div>}
    {!loading&&data&&<><div className="section-title"><h2>Related messages</h2><span>{data.items.length} shown · checked {new Date(data.checkedAt).toLocaleString()}</span></div><p className="subtle inbox-scope">{data.scope}</p>{data.items.length?<ul className="inbox-list">{data.items.map(message=><li className="panel inbox-item" key={message.id}><div className="inbox-item-top"><span className={message.unread?'badge positive':'badge'}>{message.unread?'UNREAD':'MESSAGE'}</span><time dateTime={message.receivedAt}>{message.receivedAt?new Date(message.receivedAt).toLocaleString():'Date unavailable'}</time></div><h3>{message.subject}</h3><p className="inbox-from">From {message.from}</p><p className="subtle">{message.snippet}</p><div className="inbox-item-foot"><span>Related to <strong>{message.jobTitle}</strong> · {message.company}</span>{message.url&&<a className="button quiet" href={message.url} target="_blank" rel="noopener noreferrer">Open in Gmail<ExternalLink size={15}/></a>}</div></li>)}</ul>:<div className="empty-state"><div className="empty-icon"><Mail size={29}/></div><h2>No related messages found</h2><p>{applicationCount?'We checked recent Inbox results for the employers in your Applications list. A confirmation may arrive later or at the email address on your CV if it differs from your sign-in.':'Choose Apply on a job first; messages must match a job in Applications to appear here.'}</p></div>}</>}
  </section>;
}
