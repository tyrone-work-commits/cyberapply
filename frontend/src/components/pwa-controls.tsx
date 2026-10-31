'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/workspace';
import { clearOfflineAccount, offlineIntents, removeOfflineIntent, saveOfflineJobs, type OfflineIntent } from '@/lib/offline';
import { Badge, Button, Card, ErrorNotice, Icon, Modal } from './ui';
import { ApplicationHold, type HeldApplication } from './application-hold';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;

export function ServiceWorkerRegistration() {
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); installEvent = event as InstallEvent; window.dispatchEvent(new Event('cyberapply-install-ready')); };
    window.addEventListener('beforeinstallprompt', capture);
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => { /* Installation help remains available without offline support. */ });
    }
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);
  return null;
}

export function MobileInstallPanel() {
  const { user, notify } = useWorkspace();
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [apple, setApple] = useState(false);
  useEffect(() => {
    const check = () => { setInstallable(!!installEvent); setInstalled(matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone); };
    check(); setApple(/iPad|iPhone|iPod/.test(navigator.userAgent));
    const installed = () => { installEvent = null; setInstalled(true); setInstallable(false); };
    window.addEventListener('cyberapply-install-ready', check); window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('cyberapply-install-ready', check); window.removeEventListener('appinstalled', installed); };
  }, []);
  return <Card className="stack"><div className="section-heading"><h3>CyberApply on your home screen</h3><Icon name="phone" size={22} /></div><p className="muted">Open your job search like an app. Saved listings stay available for offline reading on this device.</p>
    {installed ? <Badge tone="success">App installed</Badge> : installable ? <Button onClick={async () => { if (!installEvent) return; await installEvent.prompt(); await installEvent.userChoice; installEvent = null; setInstallable(false); }}>Install CyberApply <Icon name="download" size={17} /></Button> : <p className="muted">{apple ? 'On iPhone or iPad: open in Safari → Share → Add to Home Screen.' : 'Open your browser menu and choose Install app or Add to Home Screen when available.'}</p>}
    <p className="muted">Phone installation needs an accessible secure address. The local desktop preview is ready for installation testing here.</p><a href="/offline.html">View saved listings offline <Icon name="arrow-right" size={14} /></a><Button variant="ghost" disabled={!user} onClick={async () => { if (!user) return; try { await clearOfflineAccount(user.id); notify('Offline listings and pending choices cleared.'); } catch (failure) { notify((failure as Error).message, 'error'); } }}>Clear this account’s offline data</Button>
  </Card>;
}

export function PwaControls() {
  const { user, request, refreshTick, refresh, notify, navigate } = useWorkspace();
  const [online, setOnline] = useState(true);
  const [intents, setIntents] = useState<OfflineIntent[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [held, setHeld] = useState<(HeldApplication & { title: string })[]>([]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    sessionStorage.setItem('cyberapply-offline-account', user.id);
    offlineIntents(user.id).then(items => { if (active) setIntents(items); }).catch(() => {});
    if (online) {
      const save = async () => {
        const first = await request<{ items: { job?: any }[]; total: number }>('/jobs/saved?decision=saved&limit=100&offset=0');
        const items = [...first.items];
        for (let offset = 100; offset < first.total; offset += 100) {
          const page = await request<{ items: { job?: any }[] }>(`/jobs/saved?decision=saved&limit=100&offset=${offset}`); items.push(...page.items);
        }
        if (active) await saveOfflineJobs(user.id, items.map(item => item.job || item));
      };
      save().catch(() => { /* Existing snapshots remain readable during a service interruption. */ });
    }
    return () => { active = false; };
  }, [user?.id, request, refreshTick, online]);
  async function apply(intent: OfflineIntent) {
    if (!user || !navigator.onLine || locked.current) return;
    locked.current = true; setBusy(intent.id); setError('');
    try {
      const [job, choices, profile, automation, settings] = await Promise.all([
        request<{ submission?: { automatic: boolean }; is_demo: boolean }>(`/jobs/${intent.jobId}`),
        request<{ recommended_id: string | null; items: { id: string; is_main: boolean }[] }>(`/jobs/${intent.jobId}/resume-recommendations`),
        request<{ confirmed: boolean }>('/profiles/me'), request<{ paused: boolean; remaining_today: number }>('/automation'),
        request<{ auto_resume: boolean }>('/account/settings'),
      ]);
      if (!job.submission?.automatic) throw new Error('This role uses a manual employer application. Find it in Search and open the employer website.');
      const resumeId = settings.auto_resume ? choices.recommended_id : (choices.items.find(item => item.is_main)?.id || choices.recommended_id);
      if (!profile.confirmed || !resumeId) throw new Error('Confirm your profile and review a résumé first.');
      if (automation.paused || automation.remaining_today <= 0) throw new Error('Check your application pause state and daily limit.');
      const application = await request<HeldApplication>('/applications', { method: 'POST', body: { job_id: intent.jobId, resume_id: resumeId, mode: 'automatic', undo_window_seconds: 5, idempotency_key: intent.id } });
      await removeOfflineIntent(intent.id); setIntents(items => items.filter(item => item.id !== intent.id));
      setHeld(items => [...items.filter(item=>item.id!==application.id), { ...application, title: intent.title }]); refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { locked.current = false; setBusy(''); }
  }
  if (!user) return null;
  return <>
    {(!online || intents.length > 0) && <div className="connectivity-banner" role="status"><span><Icon name="globe" size={16} />{online ? `${intents.length} offline choice${intents.length === 1 ? '' : 's'} ready to review` : 'Offline — new applications wait for a connection'}</span>{online ? <button onClick={() => { setOpen(true); setError(''); }}>Review choices <Icon name="arrow-right" size={14} /></button> : <a href="/offline.html">Read saved jobs</a>}</div>}
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Review your offline choices"><div className="stack"><p>These choices were saved on this device. We check your current profile, reviewed résumés, limits and employer connection before applying.</p>
      {intents.map(intent => <Card key={intent.id} className="stack"><h3>{intent.title}</h3><div className="row wrap"><Button loading={busy === intent.id} disabled={!!busy || !online} onClick={() => void apply(intent)}>Apply now</Button><Button variant="ghost" disabled={!!busy} onClick={async () => { await removeOfflineIntent(intent.id); setIntents(items => items.filter(item => item.id !== intent.id)); }}>Remove choice</Button></div></Card>)}
      {held.map(application=><Card key={application.id} className="stack"><ApplicationHold application={application} title={application.title} onUndone={()=>{setHeld(items=>items.filter(item=>item.id!==application.id));refresh();notify('Application undone before sending.');}}/><Button variant="ghost" onClick={() => { setOpen(false); navigate('applications'); }}>View application progress</Button></Card>)}
      {!intents.length && !held.length && <p className="muted">No pending choices on this device.</p>}<ErrorNotice error={error} />
    </div></Modal>
  </>;
}
