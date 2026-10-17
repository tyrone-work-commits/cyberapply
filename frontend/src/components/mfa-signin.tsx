'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { fetchApi } from '@/lib/api';
import type { MfaPending } from './auth-screen';
import { Button, ErrorNotice, Field, Icon, Modal } from './ui';

export function MfaSignIn({ pending, onCancel, onVerified }: {
  pending: MfaPending | null; onCancel: () => void;
  onVerified: (raw: { access_token: string; refresh_token: string }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState('');
  const [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCode(''); setError(''); setFactor(pending?.factors?.[0]?.id || ''); setChallenge(''); }, [pending]);
  async function requestCode() {
    if (!pending || pending.mode !== 'supabase' || !factor) return;
    const result = await fetchApi<{ id: string }>('/auth/mfa/provider/challenge', { method: 'POST', auth: false, body: { factor_id: factor } }, pending.access_token);
    setChallenge(result.id);
    return result.id;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      const raw = pending.mode === 'local'
        ? await fetchApi<{ access_token: string; refresh_token: string }>('/auth/mfa/verify-login', { method: 'POST', auth: false, body: { challenge_token: pending.challenge_token, code: code.trim() } })
        : await fetchApi<{ access_token: string; refresh_token: string }>('/auth/mfa/provider/verify', { method: 'POST', auth: false, body: { factor_id: factor, challenge_id: challenge || await requestCode(), code: code.trim() } }, pending.access_token);
      await onVerified(raw);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal open={!!pending} onClose={onCancel} title="Complete two-factor sign-in">
    <form className="stack" onSubmit={submit}>
      <p>Enter the current code from your authenticator. Each code can be used once.</p>
      {pending?.mode === 'supabase' && <Field label="Authenticator"><select value={factor} onChange={event => { setFactor(event.target.value); setChallenge(''); }} required>{pending.factors?.map(item => <option key={item.id} value={item.id}>{item.friendly_name || item.factor_type || 'Authenticator'}</option>)}</select></Field>}
      <Field label={pending?.mode === 'local' ? 'Authenticator or recovery code' : 'Verification code'}>
        <input value={code} onChange={event => setCode(event.target.value)} required minLength={6} maxLength={64} autoComplete="one-time-code" autoFocus inputMode={pending?.mode === 'supabase' ? 'numeric' : 'text'} />
      </Field>
      {pending?.mode === 'local' && <p className="muted">If you cannot use your authenticator, enter one unused recovery code.</p>}
      {pending?.factors?.find(item => item.id === factor)?.factor_type === 'phone' && <Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await requestCode(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>Request verification code</Button>}
      <ErrorNotice error={error} /><Button type="submit" loading={busy}>Verify and continue <Icon name="shield-check" size={17} /></Button>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Return to sign in</Button>
    </form>
  </Modal>;
}
