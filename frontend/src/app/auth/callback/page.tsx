'use client';

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { AuthSession, Brand, canonicalSession, MfaRequired, type MfaPending } from '@/components/auth-screen';
import { MfaSignIn } from '@/components/mfa-signin';
import { Badge, Button, ErrorNotice, Field, Icon, Spinner } from '@/components/ui';

type CallbackResult = { session: AuthSession; recovery: boolean };

async function completeCallback(): Promise<CallbackResult> {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get('code');
  // Remove auth credentials before any asynchronous work or session persistence.
  history.replaceState(null, '', url.pathname);
  if (fragment.has('error') || url.searchParams.has('error')) {
    throw new Error('The account provider could not complete this link. Please request a new one.');
  }
  const capabilities = await fetchApi<{ auth_mode: string }>('/auth/capabilities', { auth: false });
  if (capabilities.auth_mode !== 'supabase') {
    throw new Error('Provider sign-in is not connected in this workspace. Please use email sign-in.');
  }
  if (fragment.has('access_token') || fragment.get('type') === 'recovery') {
    const session = await canonicalSession({ access_token: fragment.get('access_token') || '', refresh_token: fragment.get('refresh_token') || '' }).catch(failure=>{if(failure instanceof MfaRequired)failure.pending.recovery=fragment.get('type')==='recovery';throw failure;});
    return { session, recovery: fragment.get('type') === 'recovery' };
  }
  const verifier = sessionStorage.getItem('cyberapply-pkce');
  if (!code || !verifier) {
    throw new Error('This link does not contain a supported sign-in session. Use the original confirmation or recovery link, or start sign-in again in this browser.');
  }
  const raw = await fetchApi<{ access_token: string; refresh_token: string }>('/auth/oauth/exchange', { method: 'POST', body: { code, code_verifier: verifier }, auth: false });
  const session = await canonicalSession(raw).catch(failure=>{if(failure instanceof MfaRequired)failure.pending.recovery=url.searchParams.get('type')==='recovery';throw failure;});
  sessionStorage.removeItem('cyberapply-pkce');
  return { session, recovery: url.searchParams.get('type') === 'recovery' };
}

function Callback() {
  const pending = useRef<Promise<CallbackResult> | null>(null);
  const [error, setError] = useState('');
  const [recoverySession, setRecoverySession] = useState<AuthSession | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [mfa, setMfa] = useState<MfaPending|null>(null);
  useEffect(() => {
    let active = true;
    // React StrictMode can run an effect twice; exchanging a one-time code must run once.
    pending.current ||= completeCallback();
    pending.current.then(result => {
      if (!active) return;
      if (result.recovery) {
        // Keep recovery credentials in memory until the password is updated.
        setRecoverySession(result.session);
      } else {
        sessionStorage.setItem('cyberapply-session', JSON.stringify(result.session));
        sessionStorage.removeItem('cyberapply-demo');
        location.replace('/');
      }
    }).catch(failure => { if (active) { if(failure instanceof MfaRequired)setMfa(failure.pending);else setError(failure instanceof Error ? failure.message : 'This sign-in link could not be completed.'); } });
    return () => { active = false; };
  }, []);
  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (!recoverySession || busy) return;
    if (password !== confirmation) { setError('The new passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await fetchApi('/auth/password', { method: 'PUT', body: { password }, auth: false }, recoverySession.access_token);
      sessionStorage.removeItem('cyberapply-session');
      sessionStorage.removeItem('cyberapply-demo');
      pending.current = null;
      setRecoverySession(null); setPassword(''); setConfirmation(''); setComplete(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The password could not be updated. Please request a new recovery link.');
    } finally { setBusy(false); }
  };
  return <main className="callback-page">
    <div className="stack" style={{ width: 'min(420px, calc(100vw - 48px))', textAlign: 'left' }}>
      <Brand />
      <MfaSignIn pending={mfa} onCancel={()=>location.replace('/?auth=signin')} onVerified={async raw=>{const session=await canonicalSession(raw);sessionStorage.removeItem('cyberapply-pkce');if(mfa?.recovery)setRecoverySession(session);else{sessionStorage.setItem('cyberapply-session',JSON.stringify(session));sessionStorage.removeItem('cyberapply-demo');location.replace('/');}setMfa(null);}}/>
      {complete ? <><Badge tone="success"><Icon name="check-circle" size={15} /> Password updated</Badge><h1>You’re ready for a fresh start.</h1><p className="muted">Sign in with your new password to return to your workspace.</p><Button onClick={() => location.replace('/?auth=signin')}>Back to sign in <Icon name="arrow-right" size={17} /></Button></> : recoverySession ? <form className="stack" onSubmit={reset}>
        <Badge tone="info"><Icon name="lock" size={14} /> Account recovery</Badge><h1>Choose a new password.</h1><p className="muted">Update the password for {recoverySession.user.email || recoverySession.user.phone || 'your account'}.</p>
        <Field label="New password" hint="Use at least 12 characters."><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></Field>
        <Field label="Confirm new password"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>
        <ErrorNotice error={error} /><Button type="submit" loading={busy}>Update password <Icon name="arrow-right" size={17} /></Button><Button variant="ghost" disabled={busy} onClick={() => location.replace('/?auth=signin')}>Cancel and return to sign in</Button>
      </form> : error ? <><h1>Let’s try that again</h1><ErrorNotice error={error} /><Button onClick={() => location.replace('/?auth=signin')}>Back to sign in</Button></> : <><Spinner /><h1>Finishing your sign-in…</h1><p className="muted">Your workspace is just a moment away.</p></>}
    </div>
  </main>;
}

export default function Page() { return <Suspense fallback={<Spinner />}><Callback /></Suspense>; }
