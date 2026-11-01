'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { fetchApi } from '@/lib/api';
import type { MfaPending } from './auth-screen';
import { Button, ErrorNotice, Field, Icon, Modal } from './ui';

export function MfaSignIn({pending,onCancel,onVerified}:{
  pending:MfaPending|null;onCancel:()=>void;
  onVerified:(raw:{access_token:string;refresh_token:string})=>Promise<void>;
}) {
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setCode('');setError('');},[pending]);
  async function submit(event:FormEvent) {
    event.preventDefault();if(!pending||busy)return;
    setBusy(true);setError('');
    try {
      const raw=await fetchApi<{access_token:string;refresh_token:string}>('/auth/mfa/verify-login',{
        method:'POST',auth:false,body:{challenge_token:pending.challenge_token,code:code.trim()},
      });
      await onVerified(raw);
    } catch(failure){setError((failure as Error).message);}
    finally{setBusy(false);}
  }
  return <Modal open={!!pending} onClose={onCancel} title="Complete two-factor sign-in">
    <form className="stack" onSubmit={submit}>
      <p>Enter the current code from your authenticator. Each code can be used once.</p>
      <Field label="Authenticator or recovery code"><input value={code} onChange={event=>setCode(event.target.value)} required minLength={6} maxLength={64} autoComplete="one-time-code" autoFocus/></Field>
      <p className="muted">If you cannot use your authenticator, enter one unused recovery code.</p>
      <ErrorNotice error={error}/><Button type="submit" loading={busy}>Verify and continue <Icon name="shield-check" size={17}/></Button>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Return to sign in</Button>
    </form>
  </Modal>;
}
