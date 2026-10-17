'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
import type { User } from '@/lib/workspace';
import { fetchApi } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Button, Field, Icon, Badge, Modal, ErrorNotice } from './ui';
import { MfaSignIn } from './mfa-signin';
import { authorizationUrl, clearOAuthAttempt, prepareOAuth, providerMessage, type AuthCapabilities, type OAuthProvider } from '@/lib/oauth';
export function Brand(){return <span className="brand"><span className="brand-mark"><Icon name="shield" size={23}/><span/></span>cyber<span>apply</span><span className="brand-dot">.</span></span>;}
export type AuthSession = { access_token: string; refresh_token: string; user: User };
type ProviderSession = { access_token?: string; refresh_token?: string; user?: unknown; mfa_required?: boolean; challenge_token?: string };
export type MfaPending = { mode: 'local' | 'supabase'; challenge_token?: string; access_token?: string; refresh_token?: string; recovery?: boolean; factors?: { id: string; friendly_name?: string; factor_type?: string }[] };
export class MfaRequired extends Error { constructor(public pending: MfaPending) { super('Complete two-factor sign-in.'); } }

export async function canonicalSession(raw: ProviderSession): Promise<AuthSession> {
  if (raw.mfa_required && raw.challenge_token) throw new MfaRequired({ mode: 'local', challenge_token: raw.challenge_token });
  // Refresh tokens are opaque; their length is not an identity or assurance check.
  if (typeof raw.access_token !== 'string' || raw.access_token.length < 20 || raw.access_token.length > 16384 || typeof raw.refresh_token !== 'string' || raw.refresh_token.length === 0 || raw.refresh_token.length > 4096) {
    throw new Error('The sign-in session is incomplete. Please try signing in again.');
  }
  const status = await fetchApi<{ mode: string; verification_required?: boolean; factors?: { id: string; status: string; friendly_name?: string; factor_type?: string }[] }>('/auth/mfa/status', { auth: false }, raw.access_token);
  if (status.verification_required) throw new MfaRequired({ mode: 'supabase', access_token: raw.access_token, refresh_token: raw.refresh_token, factors: status.factors?.filter(item => item.status === 'verified') });
  const user = await fetchApi<User>('/auth/me', { auth: false }, raw.access_token);
  return { access_token: raw.access_token, refresh_token: raw.refresh_token, user };
}
export function AuthScreen(){
 const {request,login,startDemo,notify}=useWorkspace();const {theme,setTheme,themes}=useTheme();
 const [mode,setMode]=useState<'signup'|'signin'|'phone'|'reset'>('signup');const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [phone,setPhone]=useState('');const [code,setCode]=useState('');const [sent,setSent]=useState(false);const [showPassword,setShowPassword]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [capabilities,setCapabilities]=useState<AuthCapabilities|null>(null);const [themeOpen,setThemeOpen]=useState(false);const [resetReady,setResetReady]=useState(false);
 const [mfa,setMfa]=useState<MfaPending|null>(null);const [resetMfa,setResetMfa]=useState('');
 const [capabilitiesLoading,setCapabilitiesLoading]=useState(true);const [capabilitiesError,setCapabilitiesError]=useState('');
 const [oauthError,setOAuthError]=useState('');const [oauthProvider,setOAuthProvider]=useState<OAuthProvider|null>(null);
 const oauthLock=useRef(false);const oauthNotice=useRef<HTMLDivElement>(null);
 const loadCapabilities=useCallback(async(signal?:AbortSignal)=>{
  setCapabilitiesLoading(true);setCapabilitiesError('');
  try{setCapabilities(await request<AuthCapabilities>('/auth/capabilities',{auth:false,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)}));}
  catch{if(!signal?.aborted){setCapabilities(null);setCapabilitiesError('We couldn’t check the sign-in options. Check your connection and try again.');}}
  finally{if(!signal?.aborted)setCapabilitiesLoading(false);}
 },[request]);
 useEffect(()=>{
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('access_token')||fragment.get('type')==='recovery'){location.replace(`/auth/callback${location.hash}`);return;}
  if(new URLSearchParams(location.search).get('auth')==='signin')setMode('signin');
  const controller=new AbortController();void loadCapabilities(controller.signal);
  return()=>controller.abort();
 },[loadCapabilities]);
 useEffect(()=>{if(oauthError)oauthNotice.current?.focus();},[oauthError]);
 const changeMode=(next:typeof mode)=>{if(oauthLock.current)return;setMode(next);setError('');setOAuthError('');setSent(false);setCode('');setResetReady(false);setPassword('');setMfa(null);setResetMfa('');};
 const localReset=capabilities?.auth_mode==='local'&&resetReady;
 const saveSession=async(raw:ProviderSession)=>{try{login(await canonicalSession(raw));return true;}catch(failure){if(failure instanceof MfaRequired){setMfa(failure.pending);return false;}throw failure;}};
 const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{
  if(mode==='phone'){
   if(!capabilities?.phone)throw new Error('Phone sign-in is not connected yet. Please use email.');
   const normalizedPhone=phone.replace(/\s+/g,'');
   if(!/^\+[1-9]\d{7,14}$/.test(normalizedPhone))throw new Error('Use your country code followed by digits, for example +2348000000000.');
   setPhone(normalizedPhone);
   if(!sent){await request('/auth/phone/request-code',{method:'POST',body:{phone:normalizedPhone},auth:false});setSent(true);notify('Verification code requested.');}
   else{if(!/^\d{6,10}$/.test(code.trim()))throw new Error('Enter the 6–10 digit verification code.');const session=await request<ProviderSession>('/auth/phone/verify',{method:'POST',body:{phone:normalizedPhone,token:code.trim()},auth:false});await saveSession(session);}return;
  }
  if(mode==='reset'){
   if(localReset){await request('/auth/password/reset',{method:'POST',body:{token:code.trim(),password,mfa_code:resetMfa.trim()||undefined},auth:false});changeMode('signin');notify('Your password was updated. Please sign in.');}
   else{await request('/auth/password/request-reset',{method:'POST',body:{email:email.trim()},auth:false});setSent(true);}return;
  }
  if(mode==='signup'){const response=await request<ProviderSession>('/auth/register',{method:'POST',body:{email:email.trim(),password},auth:false});if(response.access_token){await saveSession(response);return;}if(capabilities?.auth_mode==='supabase'){notify('Check your email to confirm your account, then sign in.','info');changeMode('signin');return;}}
  const session=await request<ProviderSession>('/auth/login',{method:'POST',body:{email:email.trim(),password},auth:false});if(await saveSession(session))notify(mode==='signup'?'Your account is ready. Let’s build your profile.':'Welcome back.');
 }catch(err){setError((err as Error).message);}finally{setBusy(false);}};
 const oauth=async(provider:OAuthProvider)=>{
  if(oauthLock.current||busy||capabilitiesLoading)return;
  setError('');setOAuthError('');
  if(!capabilities?.[provider]){setOAuthError(capabilitiesError||providerMessage(provider,capabilities));return;}
  oauthLock.current=true;setBusy(true);setOAuthProvider(provider);
  try{
   const body=await prepareOAuth(provider);
   const response=await request<{authorization_url:string}>(`/auth/oauth/${provider}/start`,{method:'POST',body,auth:false,signal:AbortSignal.timeout(12000)});
   location.assign(authorizationUrl(response.authorization_url,provider,body));
  }catch(err){clearOAuthAttempt();setOAuthError(err instanceof Error?err.message:'Sign-in could not start. Please try again.');oauthLock.current=false;setBusy(false);setOAuthProvider(null);}
 };
 return <div className="auth-page"><section className="auth-side"><header className="auth-top"><Brand/><Button variant="ghost" className="icon-btn" aria-label="Choose appearance" onClick={()=>setThemeOpen(true)}><Icon name="palette"/></Button></header><div className="auth-form-wrap"><Badge tone="info"><Icon name="sparkles" size={13}/> YOUR NEXT CHAPTER</Badge><h1>{mode==='signin'?'Good to see\nyou again.':mode==='phone'?'Let’s get\nyou connected.':mode==='reset'?'A fresh start\nfor your account.':'Your next role.\nLess legwork.'}</h1><p className="auth-subtitle">{mode==='signup'?'Find your fit in cybersecurity. We’ll help with the rest.':mode==='signin'?'Your career search, right where you left it.':mode==='phone'?'Sign in securely with your phone number.':'We’ll help you get back to your job search.'}</p>
 {(mode==='signup'||mode==='signin')&&<><div className="auth-tabs" role="group" aria-label="Account access"><button aria-pressed={mode==='signup'} className={mode==='signup'?'active':''} onClick={()=>changeMode('signup')}>Create account</button><button aria-pressed={mode==='signin'} className={mode==='signin'?'active':''} onClick={()=>changeMode('signin')}>Sign in</button></div><div className="social-buttons"><Button variant="secondary" onClick={()=>oauth('google')} disabled={busy||capabilitiesLoading} loading={oauthProvider==='google'} aria-describedby="oauth-status"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="#4285f4" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4.1h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c2-1.8 3-4.5 3-7.7Z"/><path fill="#34a853" d="M12 22c2.8 0 5.2-.9 6.8-2.4l-3.3-2.6c-.9.6-2 .9-3.5.9-2.7 0-4.9-1.8-5.7-4.3H2.9v2.7A10.2 10.2 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.3 13.6a6 6 0 0 1 0-3.2V7.7H2.9a10 10 0 0 0 0 8.6l3.4-2.7Z"/><path fill="#ea4335" d="M12 6.1c1.6 0 3 .6 4.1 1.6l3-3A10 10 0 0 0 2.9 7.7l3.4 2.7C7.1 8 9.3 6.1 12 6.1Z"/></svg>{oauthProvider==='google'?'Opening Google…':'Continue with Google'}</Button><Button variant="secondary" onClick={()=>oauth('apple')} disabled={busy||capabilitiesLoading} loading={oauthProvider==='apple'} aria-describedby="oauth-status"><svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M17.9 12.7c0-2 1.6-3.1 1.7-3.2-1-1.5-2.6-1.7-3.2-1.7-1.3-.1-2.5.8-3.2.8-.6 0-1.6-.8-2.7-.8-1.4 0-2.7.8-3.4 2-1.5 2.5-.4 6.3 1.1 8.3.7 1 1.5 2 2.6 1.9 1-.1 1.4-.6 2.8-.6 1.3 0 1.7.6 2.9.6 1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.1-2.4 1.1-2.5-.1 0-2.3-.9-2.3-2.7ZM15.7 6.5c.6-.8 1-1.8.9-2.8-.9 0-2 .6-2.6 1.3-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.2Z"/></svg>{oauthProvider==='apple'?'Opening Apple…':'Continue with Apple'}</Button></div><div id="oauth-status" className="oauth-status" ref={oauthNotice} tabIndex={-1}>
  {capabilitiesLoading&&<p className="muted" role="status">Checking sign-in options…</p>}
  {oauthProvider&&<p className="muted" role="status">Taking you to {oauthProvider==='google'?'Google':'Apple'} to sign in securely…</p>}
  <ErrorNotice error={oauthError||capabilitiesError}/>
  {!capabilitiesLoading&&!oauthError&&!capabilitiesError&&(!capabilities?.google||!capabilities?.apple)&&<p className="muted">{!capabilities?.google&&!capabilities?.apple?'Google and Apple':!capabilities?.google?'Google':'Apple'} sign-in {capabilities?.providers?.google==='unavailable'||capabilities?.providers?.apple==='unavailable'?'is temporarily unavailable.':'needs to be connected.'} Email sign-in is available.</p>}
  {(capabilitiesError||oauthError)&&<Button variant="ghost" size="sm" disabled={busy||capabilitiesLoading} onClick={()=>{setOAuthError('');void loadCapabilities();}}><Icon name="refresh" size={15}/>Check sign-in options again</Button>}
 </div><div className="or-divider"><span/>or with your email<span/></div></>}
 <form onSubmit={submit} className="stack"><ErrorNotice error={error}/>{mode==='phone'?<><Field label="Phone number" hint="Include your country code, for example +2348000000000."><input className="field-input" type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={e=>{setPhone(e.target.value);setSent(false);setCode('');}} required placeholder="+2348000000000"/></Field>{sent&&<Field label="Verification code"><input className="field-input" inputMode="numeric" value={code} minLength={6} maxLength={10} onChange={e=>setCode(e.target.value)} required autoComplete="one-time-code"/></Field>}</>:<>{!(mode==='reset'&&localReset)&&<Field label="Email address"><input className="field-input" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></Field>}{(mode!=='reset'||localReset)&&<>{localReset&&mode==='reset'&&<Field label="Reset token"><input className="field-input" value={code} required minLength={20} maxLength={4096} onChange={e=>setCode(e.target.value)} autoComplete="off"/></Field>}<Field label={mode==='reset'?'New password':'Password'} hint={mode==='signup'||mode==='reset'?'At least 12 characters.':''}><span className="password-field"><input className="field-input" type={showPassword?'text':'password'} autoComplete={mode==='signin'?'current-password':'new-password'} required minLength={mode==='signin'?1:12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='signup'?'Create a strong password':'Enter your password'}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)}><Icon name={showPassword?'eye-off':'eye'} size={18}/></button></span></Field></>}</>}
 {mode==='signin'&&<button type="button" className="text-button auth-forgot" onClick={()=>changeMode('reset')}>Forgot password?</button>}
 {localReset&&<Field label="Authenticator or recovery code" hint="Required only if two-factor authentication is enabled."><input value={resetMfa} onChange={event=>setResetMfa(event.target.value)} autoComplete="one-time-code" maxLength={64}/></Field>}
 <Button type="submit" loading={busy&&!oauthProvider} disabled={busy} fullWidth size="lg">{mode==='signup'?'Create your account':mode==='signin'?'Sign in':mode==='phone'?sent?'Verify & sign in':'Send verification code':localReset?'Update password':'Request password reset'}<Icon name="arrow-right" size={18}/></Button>
 {mode==='reset'&&sent&&<div className="inline-notice">{capabilities?.email_delivery==='capture'?'If the account exists, reset instructions were captured in the local backend auth outbox. No email was delivered.':'If the account exists, check your email for the recovery link.'}</div>}{mode==='reset'&&capabilities?.auth_mode==='local'&&<Button variant="ghost" onClick={()=>{setResetReady(!resetReady);setError('');setPassword('');setCode('');}}>{localReset?'Request a reset token':'I have a reset token'}</Button>}{mode==='reset'&&capabilities?.auth_mode==='supabase'&&<p className="muted">Open the recovery link from your email to choose a new password securely.</p>}
 </form>{(mode==='signup'||mode==='signin')?<><Button variant="ghost" className="phone-button" fullWidth disabled={busy} onClick={()=>changeMode('phone')}><Icon name="phone" size={16}/>Continue with phone</Button><p className="auth-assurance"><Icon name="shield-check" size={15}/>Your profile. Your preferences. Your control.</p><div className="auth-demo"><span>Just taking a look?</span><button className="text-button" disabled={busy} onClick={startDemo}>Explore the demo <Icon name="arrow-right" size={15}/></button></div></>:<Button variant="ghost" onClick={()=>changeMode('signin')}><Icon name="arrow-left" size={16}/>Back to sign in</Button>}</div><footer className="auth-footer"><span>Built for your next move.</span><span>Cybersecurity careers, simplified.</span></footer></section>
 <aside className="auth-story"><div className="story-top"><span className="pill"><span className="status-dot"/> PURPOSEFUL JOB SEARCHING</span><span>01 / YOUR NEXT MOVE</span></div><div className="story-copy"><h2>A career search<br/>that works for <em>you.</em></h2><p>Less time chasing applications.<br/>More time building what comes next.</p></div><div className="story-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><div className="story-floating fit-floating"><div className="small-icon"><Icon name="sparkles"/></div><div><strong>A clearer picture</strong><span>See how your skills fit</span></div><span className="mini-ring">94<span>%</span></span></div><div className="story-job"><div className="story-job-top"><span className="company-logo violet">S<sup>•</sup></span><Badge tone="success"><span className="status-dot"/> Strong match</Badge></div><h3>SOC Analyst</h3><p>Example Security Operations</p><div className="row"><span className="chip"><Icon name="globe" size={13}/>Remote</span><span className="chip">Full time</span></div><div className="story-job-bottom"><span><Icon name="shield-check" size={16}/>Ready when you are</span><span className="round-arrow"><Icon name="arrow-right"/></span></div></div><div className="story-floating progress-floating"><span className="check-round"><Icon name="check" size={16}/></span><div><strong>One step closer.</strong><span>Stay organized, from first match to offer.</span></div></div></div><div className="story-bottom"><div><Icon name="compass"/><strong>Discover your fit</strong><span>Roles that match your direction</span></div><div><Icon name="file-text"/><strong>Put your best forward</strong><span>Useful résumé insights</span></div><div><Icon name="briefcase"/><strong>Keep moving</strong><span>Every application, in one place</span></div></div><div className="story-note">Illustrative preview · Fictional role</div></aside>
 <MfaSignIn pending={mfa} onCancel={()=>setMfa(null)} onVerified={async raw=>{login(await canonicalSession(raw));setMfa(null);setPassword('');notify('Two-factor sign-in complete.');}}/>
 <Modal open={themeOpen} onClose={()=>setThemeOpen(false)} title="Make yourself at home"><p className="muted">Choose a theme. You can change it whenever you like.</p><div className="theme-grid">{themes.map(t=><button className={`theme-option ${theme===t.id?'selected':''}`} key={t.id} onClick={()=>setTheme(t.id)} aria-pressed={theme===t.id}><span className="theme-swatches">{t.colors.map(c=><span key={c} style={{background:c}}/>)}</span><strong>{t.name}</strong><span>{t.description}</span>{theme===t.id&&<Icon name="check-circle" size={18}/>}</button>)}</div></Modal>
 </div>;
}
