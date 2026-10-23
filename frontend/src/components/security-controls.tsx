'use client';

import { useState, type FormEvent } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { canonicalSession, type AuthSession } from './auth-screen';
import { Badge, Button, Card, ErrorNotice, Field, Icon, Modal, Spinner } from './ui';

type MfaStatus = { mode: 'local' | 'supabase'; enabled: boolean; recovery_codes_remaining?: number; factors?: { id: string; friendly_name?: string; status: string }[] };
type Setup = { mode?: string; secret?: string; qr_code?: string; id?: string; totp?: { qr_code: string; secret: string; uri: string } };
type Action = 'enroll' | 'disable' | 'recovery' | 'export' | 'delete';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SecurityControls() {
  const { request, demo, login, logout, notify, refresh } = useWorkspace();
  const status = useLoad<MfaStatus>(demo ? null : '/auth/mfa/status');
  const [action, setAction] = useState<Action | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const local = status.data?.mode !== 'supabase';
  function close() { if (!busy) { setAction(null); setPassword(''); setCode(''); setConfirmation(''); setError(''); } }
  function start(next: Action) { close(); setAction(next); }
  function updated(session?: AuthSession, codes?: string[]) {
    if (session) login(session);
    if (codes) { setRecovery(codes); setSaved(false); }
    setAction(null); setPassword(''); setCode(''); setSetup(null); status.reload(); refresh();
  }
  async function execute(event: FormEvent) {
    event.preventDefault();
    if (!action || busy) return;
    setBusy(true); setError('');
    try {
      const proof = { password: local ? password : undefined, code: code.trim() || undefined };
      if (action === 'enroll') {
        setSetup(await request<Setup>('/auth/mfa/enroll', { method: 'POST', body: proof }));
        setAction(null); setPassword(''); setCode('');
      } else if (action === 'export') {
        const blob = await request<Blob>('/account/export', { method: 'POST', body: proof, responseType: 'blob' });
        download(blob, 'cyberapply-data.zip'); setAction(null); setPassword(''); setCode(''); notify('Your private account export is ready.');
      } else if (action === 'delete') {
        const result = await request<{ status: string; message: string }>('/account', { method: 'DELETE', body: { ...proof, confirmation } });
        setAction(null); setPassword(''); setCode(''); await logout(); notify(result.message, result.status === 'complete' ? 'success' : 'info');
      } else {
        const result = await request<{ session: AuthSession; recovery_codes?: string[] }>(action === 'disable' ? '/auth/mfa/disable' : '/auth/mfa/recovery-codes', { method: 'POST', body: proof });
        updated(result.session, result.recovery_codes); notify(action === 'disable' ? 'Two-factor authentication disabled.' : 'New recovery codes created. Previous codes are no longer valid.');
      }
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function confirmSetup(event: FormEvent) {
    event.preventDefault(); if (!setup || busy) return;
    setBusy(true); setError('');
    try {
      if (local) {
        const result = await request<{ session: AuthSession; recovery_codes: string[] }>('/auth/mfa/confirm', { method: 'POST', body: { code: code.trim() } });
        updated(result.session, result.recovery_codes);
      } else {
        const challenge = await request<{ id: string }>('/auth/mfa/provider/challenge', { method: 'POST', body: { factor_id: setup.id } });
        const raw = await request<{ access_token: string; refresh_token: string }>('/auth/mfa/provider/verify', { method: 'POST', body: { factor_id: setup.id, challenge_id: challenge.id, code: code.trim() } });
        updated(await canonicalSession(raw));
      }
      notify('Authenticator enabled. Use a new code for your next sign-in.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  if (demo) return <Card className="stack"><h3>Security and private data</h3><p className="muted">Create your own account to enable an authenticator, export your data or delete your account. Demo account changes are simulated separately.</p></Card>;
  return <div className="stack security-controls">
    <Card className="stack"><div className="section-heading"><h3>Two-factor authentication</h3><Badge tone={status.data?.enabled ? 'success' : 'neutral'}>{status.data?.enabled ? 'Enabled' : 'Not enabled'}</Badge></div>
      <p className="muted">Protect sign-in with a code from Google Authenticator, Microsoft Authenticator or another compatible app.</p>
      {status.loading && !status.data ? <Spinner /> : <div className="row wrap">{!status.data?.enabled ? <Button onClick={() => start('enroll')} disabled={!!status.error}>Set up authenticator <Icon name="shield" size={17} /></Button> : local ? <><Button variant="secondary" onClick={() => start('recovery')}>Replace recovery codes</Button><Button variant="ghost" onClick={() => start('disable')}>Disable authenticator</Button></> : status.data?.factors?.filter(factor => factor.status === 'verified').map(factor => <Button key={factor.id} variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await request(`/auth/mfa/provider/factors/${factor.id}`, { method: 'DELETE' }); await logout(); notify('Authenticator removed. Sign in again to continue.','info'); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>Remove {factor.friendly_name || 'authenticator'}</Button>)}</div>}
      {local && status.data?.enabled && <p className="muted">{status.data.recovery_codes_remaining} unused recovery codes remaining.</p>}<ErrorNotice error={status.error} />
    </Card>
    <Card className="stack"><h3>Your private data</h3><p className="muted">Download your profile, résumés, applications, saved jobs, schedules and inbox records with your uploaded files. Passwords and connection secrets are excluded.</p><Button variant="secondary" onClick={() => start('export')}><Icon name="download" size={17} />Export my data</Button><div className="divider" /><p className="muted">Deleting your CyberApply account stops new work, removes your private files and records, and signs you out. Active sends or unavailable storage may delay final cleanup.</p><Button variant="ghost" onClick={() => start('delete')}><Icon name="trash" size={17} />Delete my CyberApply account</Button></Card>
    {!action && !setup && <ErrorNotice error={error} />}
    <Modal open={!!action} onClose={close} title={action === 'export' ? 'Export your private data' : action === 'delete' ? 'Delete your CyberApply account' : action === 'enroll' ? 'Set up your authenticator' : action === 'disable' ? 'Disable your authenticator' : 'Replace recovery codes'}>
      <form className="stack" onSubmit={execute}>
        {local ? <Field label="Current account password"><input type="password" required value={password} maxLength={128} autoComplete="current-password" onChange={event => setPassword(event.target.value)} /></Field> : <p>For this action, sign-in—including your enabled second factor—must have been completed within the last five minutes.</p>}
        {local && status.data?.enabled && <Field label="New authenticator or unused recovery code" hint="Wait for a fresh code if you used the current one to sign in."><input value={code} required maxLength={64} autoComplete="one-time-code" onChange={event => setCode(event.target.value)} /></Field>}
        {action === 'delete' && <><p>Your CyberApply records and files will be erased. Applications already sent to employers remain with those employers.</p><Field label="Type DELETE MY ACCOUNT to continue"><input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required /></Field></>}
        <ErrorNotice error={error} /><Button type="submit" loading={busy} disabled={action === 'delete' && confirmation !== 'DELETE MY ACCOUNT'}>{action === 'delete' ? 'Delete account and sign out' : action === 'export' ? 'Download private export' : 'Continue'} <Icon name="arrow-right" size={17} /></Button><Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
      </form>
    </Modal>
    <Modal open={!!setup} onClose={() => { if (!busy) { setSetup(null); setCode(''); setError(''); } }} title="Connect your authenticator">
      <form className="stack" onSubmit={confirmSetup}><p>Scan this QR code in your authenticator, or enter the setup key manually. Then enter its current six-digit code.</p>
        <img className="authenticator-qr" src={setup?.qr_code || (setup?.totp?.qr_code?.startsWith('data:') ? setup.totp.qr_code : setup?.totp?.qr_code ? `data:image/svg+xml;utf8,${encodeURIComponent(setup.totp.qr_code)}` : undefined)} alt="Authenticator setup QR code" width="220" height="220" />
        <Field label="Manual setup key"><input readOnly value={setup?.secret || setup?.totp?.secret || ''} aria-label="Manual authenticator setup key" /></Field>
        <Field label="Six-digit authenticator code"><input required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value)} /></Field><ErrorNotice error={error} /><Button type="submit" loading={busy}>Verify and enable</Button>
      </form>
    </Modal>
    <Modal open={!!recovery.length} onClose={() => { if (saved) setRecovery([]); }} title="Save your recovery codes"><div className="stack"><p>Store these codes privately. Each works once when you cannot use your authenticator. They are shown only now.</p><pre className="recovery-list">{recovery.join('\n')}</pre><Button variant="secondary" onClick={() => download(new Blob([recovery.join('\n')], { type: 'text/plain' }), 'cyberapply-recovery-codes.txt')}>Download recovery codes</Button><label className="check-field"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />I have saved these recovery codes</label><Button disabled={!saved} onClick={() => setRecovery([])}>Done</Button></div></Modal>
  </div>;
}
