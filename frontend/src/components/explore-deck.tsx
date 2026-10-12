'use client';

import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { ApiError, useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { Badge, Button, EmptyState, ErrorNotice, Field, Icon, Modal, Spinner } from './ui';
import { CompanyMark, label, salaryLabel, type Job } from './job-detail';
import styles from './explore-deck.module.css';

type Resume = { id: string; title: string; reviewed: boolean; is_main: boolean };
type Application = { id: string; status: string; is_demo: boolean; confirmation_id?: string | null; missing_fields?: string[]; error_message?: string | null };
type Latest = { job: Job; application: Application; error?: string };
type Gesture = { id: number; x: number; y: number; axis: 'horizontal' | 'vertical' | null };
const pendingStates = new Set(['queued', 'preparing', 'ready', 'submitting']);

function applicationStatus(app: Application) {
  if (app.status === 'applied' && app.confirmation_id) return app.is_demo ? 'Demo application confirmed' : 'Application sent';
  if (app.status === 'applied') return 'Waiting for a submission receipt';
  return ({ queued: 'Queued to apply automatically', preparing: 'Preparing your application', ready: 'Ready for submission', submitting: 'Submitting your application', needs_review: 'Application needs review', needs_attention: 'Application needs attention', uncertain: 'Submission outcome unknown', failed: 'Application could not be sent', cancelled: 'Application cancelled' } as Record<string, string>)[app.status] || 'Application status updated';
}

export function ExploreDeck({ jobs, loading, filterKey, onChanged, onDetails, onReset }: {
  jobs: Job[]; loading: boolean; filterKey: string; onChanged: () => void; onDetails: (job: Job) => void; onReset: () => void;
}) {
  const { request, notify, navigate, refresh, demo } = useWorkspace();
  const resumes = useLoad<{ items: Resume[] }>('/resumes?limit=100');
  const profile = useLoad<{ confirmed: boolean }>('/profiles/me');
  const automation = useLoad<{ paused: boolean; daily_limit: number; remaining_today: number }>('/automation');
  const [resumeId, setResumeId] = useState('');
  const [handled, setHandled] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const [exiting, setExiting] = useState<'left' | 'right' | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const gesture = useRef<Gesture | null>(null);
  const dragRef = useRef(0);
  const locked = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const card = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const hintId = useId();
  const available = jobs.filter(job => job.decision !== 'passed' && !handled.includes(job.id));
  const job = available[0];
  const selected = resumes.data?.items.find(resume => resume.id === resumeId);
  const ready = !!profile.data?.confirmed && !!selected?.reviewed;
  const paused = !!automation.data?.paused;
  const quotaFull = automation.data?.remaining_today === 0;
  const setupLoading = resumes.loading || profile.loading || automation.loading;
  const setupError = resumes.error || profile.error || automation.error;
  const canApply = ready && !paused && !quotaFull && !setupLoading && !setupError;
  const threshold = () => Math.max(76, Math.min(120, (card.current?.clientWidth || 380) * .28));
  const progress = Math.min(1, Math.abs(drag) / threshold());

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setHandled([]); setError(null); }, [filterKey]);
  useEffect(() => { gesture.current = null; dragRef.current = 0; setDrag(0); }, [job?.id]);
  useEffect(() => {
    if (!resumes.data) return;
    if (resumes.data.items.some(r => r.id === resumeId && r.reviewed)) return;
    setResumeId((resumes.data.items.find(r => r.is_main && r.reviewed) || resumes.data.items.find(r => r.reviewed))?.id || '');
  }, [resumes.data, resumeId]);

  useEffect(() => {
    if (!latest || !pendingStates.has(latest.application.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = latest.application.id;
    const poll = async () => {
      try {
        const application = await request<Application>(`/applications/${id}`);
        if (!active) return;
        setLatest(current => current?.application.id === id ? { ...current, application, error: undefined } : current);
        if (!pendingStates.has(application.status)) { refresh(); return; }
      } catch (failure) {
        if (!active) return;
        setLatest(current => current?.application.id === id ? { ...current, error: failure instanceof Error ? failure.message : 'Status update unavailable.' } : current);
      }
      if (active) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 1500);
    return () => { active = false; clearTimeout(timer); };
    // Keep one polling loop for the current application, including status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.application.id, request]);

  function resetDrag() { gesture.current = null; dragRef.current = 0; setDrag(0); }
  function setupMessage() {
    if (setupError) return setupError;
    if (setupLoading) return 'Your application settings are still loading. Try again in a moment.';
    if (!profile.data?.confirmed) return 'Confirm your profile before applying.';
    if (!selected?.reviewed) return 'Choose a reviewed résumé before applying.';
    if (paused) return 'Your application queue is paused. Resume it in your application settings.';
    return 'Your daily application limit has been reached.';
  }

  async function decide(direction: 'left' | 'right') {
    if (!job || locked.current || loading) return;
    resetDrag(); setError(null);
    if (direction === 'right' && !canApply) { const message = setupMessage(); setError(message); setAnnouncement(message); setSettings(true); return; }
    locked.current = true; setBusy(true); setExiting(direction);
    const acceptedJob = job;
    const animationStarted = performance.now();
    try {
      if (direction === 'left') {
        await request(`/jobs/${acceptedJob.id}/pass`, { method: 'POST' });
        setAnnouncement(`Passed on ${acceptedJob.title}. Next opportunity.`);
        notify('Job moved to Passed.');
      } else {
        const key = `${acceptedJob.id}:${resumeId}`;
        if (!requestKeys.current.has(key)) requestKeys.current.set(key, `swipe-${crypto.randomUUID()}`);
        const application = await request<Application>('/applications', { method: 'POST', body: { job_id: acceptedJob.id, resume_id: resumeId, mode: 'automatic', idempotency_key: requestKeys.current.get(key) } });
        if (!mounted.current) return;
        setLatest({ job: acceptedJob, application });
        const status = applicationStatus(application);
        setAnnouncement(`${acceptedJob.title}: ${status}. Next opportunity.`);
        notify(application.status === 'applied' && application.is_demo ? 'Demo application simulated. No employer was contacted.' : 'Application queued to apply automatically.', 'info');
      }
      // Let a fast local response finish the card's exit before revealing the next job.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 200 - (performance.now() - animationStarted))));
      if (mounted.current) { setHandled(ids => [...ids, acceptedJob.id]); onChanged(); }
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.code === 'duplicate_application') {
        setHandled(ids => [...ids, acceptedJob.id]); onChanged();
        setAnnouncement('This job already has an application. Find it in Applications.');
        notify('This job already has an application. Open Applications to see its status.', 'info');
      } else {
        const message = failure instanceof Error ? failure.message : 'Your decision could not be saved. Try again.';
        setError(message); setAnnouncement(message);
      }
    } finally {
      locked.current = false;
      if (mounted.current) { setBusy(false); setExiting(null); }
    }
  }

  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (busy || loading || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || (event.target as HTMLElement).closest('button,a,input,select,textarea')) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId || busy) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12) {
      if (Math.abs(dx) > Math.abs(dy) * 1.25) start.axis = 'horizontal';
      else if (Math.abs(dy) > Math.abs(dx) * 1.25) start.axis = 'vertical';
    }
    if (start.axis !== 'horizontal') return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    if (event.cancelable) event.preventDefault();
    dragRef.current = dx; setDrag(dx);
  }
  function pointerUp(event: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const distance = dragRef.current;
    const submit = start.axis === 'horizontal' && Math.abs(distance) >= threshold();
    resetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (submit) void decide(distance < 0 ? 'left' : 'right');
  }

  function pointerLost(event: PointerEvent<HTMLElement>) {
    // Touch starts with capture on a child. Ignore that child's bubbled transfer to the card.
    if (event.target === event.currentTarget && gesture.current?.id === event.pointerId) resetDrag();
  }

  const offset = exiting ? (exiting === 'right' ? 620 : -620) : drag;
  return <section className={styles.deck} aria-label="Swipe to discover jobs">
    <div className={styles.main}>
      <div className={styles.toolbar}><span><Icon name="file-text" size={16} /><span>{selected?.title || 'Choose your résumé'}</span></span><button onClick={() => setSettings(true)} aria-label="Swipe application settings"><Icon name="settings" size={18} /></button></div>
      <p className={styles.hint} id={hintId}><span><Icon name="arrow-left" size={14} /> Swipe left to pass</span><span>Swipe right to apply <Icon name="arrow-right" size={14} /></span></p>
      <div className={styles.stage}>
        {job ? <>
          <div className={styles.backCard} aria-hidden="true" /><div className={`${styles.backCard} ${styles.secondCard}`} aria-hidden="true" />
          <article key={job.id} ref={card} className={`${styles.card} swipe-card`} data-job-id={job.id} data-dragging={!!drag} aria-roledescription="Swipeable job card" aria-label={`${job.title} at ${job.company}`} aria-describedby={hintId} aria-busy={busy} tabIndex={0}
            style={{ transform: `translate3d(${offset}px,0,0) rotate(${Math.max(-12, Math.min(12, offset / 22))}deg)`, opacity: exiting ? .2 : 1 }}
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={resetDrag}
            onLostPointerCapture={pointerLost}
            onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void decide(event.key === 'ArrowLeft' ? 'left' : 'right'); } }}>
            <div className={`${styles.stamp} ${drag < 0 ? styles.passStamp : styles.applyStamp}`} style={{ opacity: progress }} aria-hidden="true">{drag < 0 ? 'PASS' : 'APPLY'}</div>
            <div className={styles.cardHeading}><CompanyMark company={job.company} large /><div><span className={styles.company}>{job.company}</span><span className={styles.location}><Icon name="map-pin" size={13} />{job.location || 'Location not listed'}</span></div><Button variant="ghost" className={styles.bookmark} aria-label={job.decision === 'saved' ? 'Remove saved job' : 'Save current job'} disabled={busy || loading} onClick={async () => { try { await request(`/jobs/${job.id}/${job.decision === 'saved' ? 'decision' : 'save'}`, { method: job.decision === 'saved' ? 'DELETE' : 'POST' }); onChanged(); } catch (failure) { setError((failure as Error).message); } }}><Icon name={job.decision === 'saved' ? 'check' : 'bookmark'} size={20} /></Button></div>
            <h2 className={styles.title}>{job.title}</h2><p className={styles.salary}>{salaryLabel(job)}</p>
            <div className={styles.tags}>{job.remote && <Badge tone="success"><Icon name="globe" size={12} />Remote</Badge>}<Badge>{label(job.level)}</Badge><Badge>{label(job.employment_type)}</Badge>{job.is_demo && <Badge tone="warning">Demo role</Badge>}</div>
            <div className={`${styles.scroll} swipe-description`} tabIndex={0} aria-label="Scrollable job description">
              <section className={styles.description}><h3>About the role</h3><p>{job.description || 'Open the role details for more information.'}</p></section>
              {!!job.required_skills?.length && <section className={styles.description}><h3>Skills for this role</h3><div className={styles.skills}>{job.required_skills.map(skill => <span key={skill}>{skill}</span>)}</div></section>}
              {!!job.required_certifications?.length && <section className={styles.description}><h3>Required certifications</h3><p>{job.required_certifications.join(' · ')}</p></section>}
              <Button variant="ghost" onClick={() => onDetails(job)}>View details and fit report <Icon name="arrow-right" size={16} /></Button>
            </div>
            <div className={styles.cardFoot}><span><Icon name="shield-check" size={14} />{job.match ? `${job.match.score} / 100 fit estimate` : 'Find your fit'}</span><span>{available.length} in this set</span></div>
          </article>
        </> : loading ? <div className={styles.loading}><Spinner /><p>Finding your next opportunity…</p></div> : <div className={styles.empty}><EmptyState icon="check-circle" title="You’re caught up." description="Find more roles, revisit Passed jobs, or check the applications you’ve started." action={<Button variant="secondary" onClick={onReset}>Show more opportunities <Icon name="refresh" size={16} /></Button>} /></div>}
      </div>
      <div className={styles.actions}><button className={styles.passButton} onClick={() => void decide('left')} disabled={!job || busy || loading} aria-label="Pass on current role"><Icon name="x" size={26} /><span>Pass</span></button><button className={styles.detailButton} onClick={() => job && onDetails(job)} disabled={!job || busy} aria-label="Open current role details"><Icon name="eye" size={23} /><span>Details</span></button><button className={styles.applyButton} onClick={() => void decide('right')} disabled={!job || busy || loading} aria-label="Apply to current role automatically">{busy && exiting === 'right' ? <Spinner /> : <Icon name="arrow-right" size={26} />}<span>Apply</span></button></div>
      <p className={styles.consent}>{demo || job?.is_demo ? 'Demo swipes simulate applications. No employer receives them.' : 'Swiping right starts automatic submission with your selected résumé.'}</p>
      <ErrorNotice error={error} />
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      {latest && <div className={`${styles.receipt} swipe-receipt`} role="status" aria-live="polite"><div className={styles.receiptIcon}>{pendingStates.has(latest.application.status) ? <Spinner /> : <Icon name={latest.application.status === 'applied' && latest.application.confirmation_id ? 'check-circle' : 'alert'} />}</div><div><strong>{applicationStatus(latest.application)}</strong><p>{latest.job.title} · {latest.job.company}</p>{latest.application.is_demo && <small>Simulation only · no employer was contacted.</small>}{latest.application.error_message && <small>{latest.application.error_message}</small>}{!!latest.application.missing_fields?.length && <small>Complete: {latest.application.missing_fields.map(label).join(', ')}</small>}{latest.error && <small>{latest.error}</small>}</div><button onClick={() => navigate('applications')} aria-label="View application progress"><Icon name="arrow-right" size={18} /></button></div>}
    </div>
    <aside className={styles.guide}><Badge tone="info"><Icon name="sparkles" size={12} /> YOUR NEXT MOVE</Badge><h2>Good things start<br />with a swipe.</h2><p>Take a closer look. When a role feels right, let your application follow.</p><div className={styles.guideRow}><span className={styles.leftIcon}><Icon name="arrow-left" size={20} /></span><div><strong>Left means pass</strong><p>Move on to the next role. You can revisit this one in Passed.</p></div></div><div className={styles.guideRow}><span className={styles.rightIcon}><Icon name="arrow-right" size={20} /></span><div><strong>Right means apply</strong><p>We use your reviewed résumé to prepare and submit to supported employers.</p></div></div><div className={styles.readiness}><Icon name={canApply ? 'shield-check' : 'alert'} size={19} /><div><strong>{setupLoading ? 'Checking your settings…' : canApply ? 'Ready for your next move' : paused ? 'Your queue is paused' : quotaFull ? 'Daily limit reached' : 'Finish your application setup'}</strong><p>{canApply ? `${automation.data?.remaining_today ?? '—'} applications remaining today` : 'Check your profile, résumé and application settings.'}</p><button onClick={() => setSettings(true)}>Application settings <Icon name="chevron-right" size={14} /></button></div></div><small>Missing answers or an unavailable employer connection will appear in Applications.</small></aside>
    <Modal open={settings} onClose={() => setSettings(false)} title="Swipe application settings"><div className="stack"><p>Choose the reviewed résumé you want to send when you swipe right. Each swipe applies to the job you’re viewing.</p><Field label="Résumé for right swipes"><select value={resumeId} onChange={event => setResumeId(event.target.value)} disabled={busy}><option value="">Choose a reviewed résumé</option>{resumes.data?.items.filter(resume => resume.reviewed).map(resume => <option key={resume.id} value={resume.id}>{resume.title}{resume.is_main ? ' · Main' : ''}</option>)}</select></Field><ErrorNotice error={setupError} /><div className="row wrap"><Badge tone={profile.data?.confirmed ? 'success' : 'warning'}>{profile.data?.confirmed ? 'Profile confirmed' : 'Confirm profile'}</Badge><Badge tone={selected?.reviewed ? 'success' : 'warning'}>{selected?.reviewed ? 'Résumé reviewed' : 'Review a résumé'}</Badge><Badge tone={paused || quotaFull ? 'warning' : 'neutral'}>{paused ? 'Queue paused' : `${automation.data?.remaining_today ?? '—'} remaining today`}</Badge></div>{(!ready || setupError) && <Button variant="secondary" onClick={() => { setSettings(false); navigate(profile.data?.confirmed ? 'profile:resume' : 'profile'); }}>Finish profile and résumé setup <Icon name="arrow-right" size={16} /></Button>}<Button variant="ghost" onClick={() => { setSettings(false); navigate('profile:automation'); }}>Manage application limits and pause <Icon name="sliders" size={16} /></Button><p className="muted">Applications that need extra information or a supported employer connection will wait for attention. Check Applications for confirmed receipts.</p><Button onClick={() => setSettings(false)}>Done <Icon name="check" size={16} /></Button></div></Modal>
  </section>;
}
