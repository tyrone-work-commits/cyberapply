'use client';
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
import { Button, ErrorNotice, Icon } from './ui';
export type HeldApplication = { id: string; status: string; send_after?: string | null; server_time?: string; undo_available?: boolean };
export function ApplicationHold({ application, title, onUndone, onExpired }: { application: HeldApplication; title?: string; onUndone: () => void; onExpired?: () => void }) {
  const { request } = useWorkspace();
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const expired = useRef(onExpired); expired.current = onExpired;
  useEffect(() => {
    if (!application.send_after || application.status !== 'queued' || application.undo_available === false) { setRemaining(0); return; }
    const duration = Date.parse(application.send_after) - (application.server_time ? Date.parse(application.server_time) : Date.now());
    const deadline = Date.now() + Math.max(0, duration); let ended = false;
    const tick = () => { const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); setRemaining(seconds); if (!seconds && !ended) { ended = true; expired.current?.(); } };
    tick(); const timer = setInterval(tick, 100); return () => clearInterval(timer);
  }, [application.id, application.send_after, application.server_time, application.status, application.undo_available]);
  if (!remaining) return null;
  return <div className="application-hold"><div><strong>Right swipe accepted · {remaining}s to Undo</strong>{title && <p>{title}</p>}<small>The application waits on the server during this countdown.</small></div><Button variant="secondary" loading={busy} onClick={async () => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await request(`/applications/${application.id}/undo`, { method: 'POST' }); onUndone(); }
    catch (failure) { setError((failure as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }}><Icon name="refresh" size={16} />Undo application</Button><ErrorNotice error={error} /></div>;
}
