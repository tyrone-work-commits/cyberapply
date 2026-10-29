"use client";
import { useEffect, useState } from 'react';
import { Bot, Check, Copy, LoaderCircle, Power, RefreshCw, ExternalLink, CircleCheck, CircleAlert } from 'lucide-react';

type AgentStatus={connected:boolean;enabled:boolean;expiresAt?:string;lastSeenAt?:string;runnerState?:string;runnerLastSeenAt?:string};
const site='https://cyberapply-internal.covenda-1182.chatgpt.site';

export function ApplicationAgentPanel(){
 const [status,setStatus]=useState<AgentStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[token,setToken]=useState(''),[authorized,setAuthorized]=useState(false),[copied,setCopied]=useState(false),[launchHint,setLaunchHint]=useState('');
 async function readStatus(){
  const response=await fetch('/api/application-agent/pair',{cache:'no-store'}),data=await response.json() as AgentStatus&{error?:string};
  if(!response.ok)throw new Error(data.error||'Application agent status could not be loaded.');
  setStatus(data);setError('');
 }
 useEffect(()=>{let active=true;const refresh=()=>{if(active&&!document.hidden)void readStatus().catch(failure=>{if(active){setStatus(null);setError((failure as Error).message);}});};refresh();const timer=setInterval(refresh,10000);document.addEventListener('visibilitychange',refresh);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[]);
 async function connect(){
  if(busy||!authorized)return;
  setBusy(true);setError('');setCopied(false);setToken('');
  try{
   const response=await fetch('/api/application-agent/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'})}),data=await response.json() as {token?:string;expiresAt?:string;error?:string};
   if(!response.ok||!data.token)throw new Error(data.error||'The connection could not be created.');
   setToken(data.token);await readStatus();
  }catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
 }
 async function disconnect(){
  if(busy)return;setBusy(true);setError('');
  try{
   const response=await fetch('/api/application-agent/pair',{method:'DELETE'}),data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||'The connection could not be removed.');
   setToken('');setAuthorized(false);await readStatus();
  }catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
 }
 const labels:Record<string,string>={checking:'Connected · checking for applications',running:'Connected in the background',working:'Connected · applying on an employer website',reconnect_required:'Reconnection required',waiting_for_connection:'Connection problem',needs_review:'Runner needs review',stopped:'Background runner stopped',not_reporting:'No recent background connection',disconnected:'Agent disconnected'};
 const live=!!status&&['checking','running','working'].includes(status.runnerState||'');
 return <section className="panel account-section" aria-labelledby="application-agent-heading">
  <div className="account-section-heading"><Bot size={21}/><div><h2 id="application-agent-heading">CV application agent</h2><p>Use your chosen CV to apply on employer websites after you swipe right.</p></div></div>
  <p className="subtle">The browser runner must stay open on your computer. It reads the employer form, fills answers supported by the exact CV saved with your request, and prepares a cover letter from your CV, the vacancy and sourced company research. It counts dated cybersecurity experience separately from other work. Tool and role experience answers need CV evidence; generated explanations are saved as drafts for your approval.</p>
  <p className="subtle">Name fields, including first and last name, use the complete full name saved in Edit Profile. Address, location, city, country, zip/postal code and phone also come from Edit Profile. Residence Yes/No questions compare the named places with saved location details. LinkedIn comes only from the chosen CV. Salary expectations use only your saved expected salary, with monthly/yearly conversion in USD; it never generates a market salary. UK, USA, Canada and Ireland visa requirements and current right to work come from separate saved Edit Profile choices. For a simple UK-or-Ireland work authorization question, Yes in either country means Yes; No requires No for both. Unanswered choices remain unknown. Newly generated answers pause for your explicit review in Applications, with an in-app approval notice. It also pauses for missing facts, consent, sign-in, CAPTCHA or unsupported questions. Applications shows the result, and only an employer confirmation can become Applied.</p>
  <div className="agent-connection-card" role="status" aria-live="polite">
   <div className="account-section-heading">{live?<CircleCheck size={21}/>:<CircleAlert size={21}/>}<div><strong>{status?(labels[status.runnerState||'not_reporting']||'Status unavailable'):'Checking background status…'}</strong><p>{live?'Your runner reported recently. Keep that computer awake and online.':status?.runnerState==='reconnect_required'?'Open setup and paste a fresh connection token.':status?.runnerState==='stopped'?'Open setup to reconnect and start the background agent.':'No active background connection has been confirmed. Open setup on the Windows computer running your agent.'}</p></div></div>
   {status?.runnerLastSeenAt&&<p className="subtle">Last background check-in: {new Date(status.runnerLastSeenAt).toLocaleString()}</p>}
   {status?.expiresAt&&<p className="subtle">Connection token expires: {new Date(status.expiresAt).toLocaleString()}</p>}
   <div className="account-actions"><a className="button" href="cyberapply-agent://setup" onClick={()=>setLaunchHint('If your browser asks, choose Open CyberApply. The setup window opens on this computer; no connection token is included in this link.')}><ExternalLink size={16}/>Open agent setup</a><button className="button quiet" type="button" disabled={busy} onClick={()=>void readStatus().catch(failure=>{setStatus(null);setError((failure as Error).message);})}><RefreshCw size={16}/>Refresh background status</button></div>
   <p className="subtle">Status refreshes every 10 seconds. On a phone you can check status, but open setup from the Windows computer with CyberApply’s desktop agent installed.</p>
   {launchHint&&<p className="subtle" role="status">{launchHint}</p>}
  </div>
  <ol className="agent-reconnect-steps"><li>Open agent setup on your Windows computer.</li><li>Authorize applications below and create or replace the connection token.</li><li>Copy the token, paste it privately into the setup window, then enable background applications.</li><li>Wait for “Connected in the background” here. A token alone does not confirm a running agent.</li></ol>
  <label className="check-label"><input type="checkbox" checked={authorized} disabled={busy} onChange={event=>setAuthorized(event.target.checked)}/><span>When I swipe Apply or queue a request, I authorize this agent to use that request’s chosen CV, saved Edit Profile contact and salary details, and supported generated answers to submit to that employer. A connected runner must be running with submission enabled.</span></label>
  <div className="account-actions"><button className="button" type="button" disabled={busy||!authorized} onClick={()=>void connect()}>{busy?<LoaderCircle size={16} className="spin"/>:<Bot size={16}/>} {status?.connected?'Replace connection token':'Enable and create connection token'}</button>{status?.connected&&<button type="button" className="button quiet" disabled={busy} onClick={()=>void disconnect()}><Power size={16}/>Disconnect agent</button>}<button type="button" className="button quiet" disabled={busy} onClick={()=>void readStatus().catch(failure=>setError((failure as Error).message))}><RefreshCw size={16}/>Check connection</button></div>
  {token&&<div className="info-strip" style={{display:'block'}}><label htmlFor="application-agent-token">Private connection token<input id="application-agent-token" type="password" readOnly value={token} autoComplete="off" spellCheck={false}/></label><button type="button" className="button quiet" onClick={()=>void navigator.clipboard.writeText(token).then(()=>setCopied(true)).catch(()=>setError('Copy was unavailable. Select and copy the token from the field.'))}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copied':'Copy token'}</button><p className="subtle">This token appears only now. Enter it privately at the runner’s prompt. Replacing it disconnects any runner using the old token.</p></div>}
  <details><summary>Run the agent on your computer</summary><p className="subtle">From your CyberApply project folder, install the browser runner once:</p><pre className="snapshot-text">python -m pip install -r application_agent/requirements.txt{'\n'}python -m playwright install chromium</pre><p className="subtle">Then start it and enter your private connection token when prompted:</p><pre className="snapshot-text">python -m application_agent.runner --site {site} --browser-channel chromium --submit</pre><p className="subtle">Keep this process open while applying from your phone or browser. To inspect and fill without submitting, omit <code>--submit</code>. You can stop the runner or disconnect it here.</p></details>
  {error&&<p className="inline-error" role="alert">{error}</p>}
 </section>;
}
