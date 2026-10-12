'use client';

import { useEffect, useRef, useState } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { ApplicationHold } from './application-hold';
import { ApplicationSchedule } from './application-schedule';
import { Badge, Button, Card, EmptyState, Field, Icon, Modal, Spinner } from '@/components/ui';

type Page<T> = { items: T[]; total: number; limit?: number; offset?: number };
type Job = { id: string; title: string; company: string; location?: string };
type Application = {
  id: string; job_id: string; resume_id: string; mode: string; status: string; version: number;
  outcome: string | null; connector_key: string; confirmation_id: string | null; is_demo: boolean;
  attempts: number; missing_fields: string[]; error_code: string | null; error_message: string | null;
  match?: { score?: number; blockers?: string[]; reasons?: string[] };
  created_at: string; updated_at: string; submitted_at: string | null;
  resume_snapshot?: { title?: string; text?: string; version?: number; captured_at?: string };
  answers?: Record<string, unknown>; cover_letter?: string; next_action?: {label:string;action:string}; send_after?:string; server_time?:string; undo_available?:boolean;
};
type AppEvent = { id: string; sequence: number; event_type: string; message: string; created_at: string; data?: Record<string, unknown> };
type Summary = { total: number; by_status: Record<string, number>; by_outcome: Record<string, number>; needs_review: number; needs_attention: number; active: number };

const statuses: Record<string, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }> = {
  queued: { label: 'Queued', tone: 'neutral' }, preparing: { label: 'Preparing', tone: 'info' },
  needs_review: { label: 'Ready for review', tone: 'warning' }, needs_attention: { label: 'Needs attention', tone: 'warning' },
  ready: { label: 'Ready to submit', tone: 'info' }, submitting: { label: 'Submitting', tone: 'info' },
  applied: { label: 'Submission confirmed', tone: 'success' }, failed: { label: 'Confirmed failure', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' }, uncertain: { label: 'Outcome unknown', tone: 'warning' },
};
const activeStates = new Set(['queued', 'preparing', 'ready', 'submitting']);
const editableStates = new Set(['needs_review', 'needs_attention', 'ready']);
const cancellableStates = new Set(['queued', 'preparing', 'needs_review', 'needs_attention', 'ready', 'failed']);
const labels: Record<string, string> = { full_name: 'Full name', first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone number', linkedin_url: 'LinkedIn URL', portfolio_url: 'Portfolio URL', work_authorization: 'Work authorization', sponsorship_required: 'Do you need sponsorship?', salary_expectation: 'Salary expectation', available_start_date: 'Available start date', security_clearance: 'Security clearance' };
const human = (value: string) => labels[value] || value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
function date(value?: string | null, full = false) {
  if (!value) return '—';
  const parsed = new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(full ? { year: 'numeric' } : {}) });
}
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${valueText(item)}`).join(' · ');
  return String(value);
}
function Status({ app }: { app: Application }) {
  const state = statuses[app.status] || { label: human(app.status), tone: 'neutral' as const };
  return <Badge tone={state.tone}>{app.status === 'applied' && app.is_demo ? 'Demo confirmed' : state.label}</Badge>;
}

function ApplicationRow({ app, onOpen }: { app: Application; onOpen: () => void }) {
  const job = useLoad<Job>(`/jobs/${app.job_id}`);
  const company = job.data?.company || 'Application';
  return <button className="application-row" onClick={onOpen}>
    <span className="company-mark">{company.slice(0, 2).toUpperCase()}</span>
    <span className="application-main"><strong>{job.data?.title || (job.error ? 'Job details unavailable' : 'Loading job details…')}</strong><span>{company}{job.data?.location ? ` · ${job.data.location}` : ''}</span><span className="next-action">{app.next_action?.label}</span><span className="row-mobile-status"><Status app={app}/>{app.outcome ? <Badge>{human(app.outcome)}</Badge> : null}</span></span>
    <span className="application-state"><Status app={app}/>{app.outcome ? <span className="outcome-label">{human(app.outcome)}</span> : null}</span>
    <span className="application-date">{date(app.submitted_at || app.created_at)}</span>
    <Icon name="chevron-right" size={17}/>
    <style jsx>{`
      .application-row{width:100%;display:flex;align-items:center;gap:16px;text-align:left;background:none;border:0;border-bottom:1px solid var(--border,#e7e8ee);padding:21px 24px;color:var(--text,#22253c);cursor:pointer;font:inherit;transition:background .15s}.application-row:last-child{border-bottom:0}.application-row:hover{background:var(--accent-soft,#f5f3ff)}.application-row:focus-visible{outline:2px solid var(--accent,#6258e8);outline-offset:-3px}.company-mark{display:grid;place-items:center;flex-shrink:0;width:44px;height:44px;border-radius:13px;background:var(--accent-soft,#efedfc);color:var(--accent,#6258e8);font-size:0.8125rem;font-weight:700;letter-spacing:.04em}.application-main{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}.application-main strong{font-size:0.9375rem;font-weight:600;overflow-wrap:anywhere}.application-main>span{font-size:0.75rem;color:var(--muted,#777b8d)}.application-state{display:flex;align-items:flex-end;flex-direction:column;gap:5px}.outcome-label{font-size:0.75rem;color:var(--muted,#777b8d)}.application-date{width:57px;font-size:0.75rem;color:var(--muted,#777b8d);text-align:right}.row-mobile-status{display:none!important}@media(max-width:600px){.application-row{padding:18px 16px;gap:12px}.application-state,.application-date{display:none}.row-mobile-status{display:block!important;margin-top:3px}.company-mark{width:39px;height:39px}}
    `}</style>
  </button>;
}

export function ApplicationsView() {
  const { navigate } = useWorkspace();
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: '20', offset: String(page * 20) });
  if (status) params.set('status', status);
  if (outcome) params.set('outcome', outcome);
  const list = useLoad<Page<Application>>(`/applications?${params}`);
  const summary = useLoad<Summary>('/applications/summary');
  const refreshRef = useRef(() => {});
  refreshRef.current = () => { list.reload(); summary.reload(); };
  useEffect(() => {
    if (!summary.data?.active) return;
    const timer = setInterval(() => refreshRef.current(), 5000);
    return () => clearInterval(timer);
  }, [summary.data?.active]);
  const update = () => refreshRef.current();
  const chooseStatus = (value: string) => { setStatus(value); setPage(0); };
  const tabs = [['', 'All applications'], ['needs_review', 'For review'], ['applied', 'Confirmed'], ['needs_attention', 'Needs attention'], ['uncertain', 'Unknown outcome']];
  return <section className="applications-view">
    <header className="applications-head"><div><p className="eyebrow">YOUR CAREER, MOVING FORWARD</p><h1>Applications</h1><p className="view-description">Every application. Every next step. All in one place.</p></div><Button variant="secondary" onClick={update} aria-label="Refresh applications"><Icon name="refresh" size={16}/>Refresh</Button></header>
    <div className="application-stats">
      {[['Total applications', summary.data?.total, 'briefcase'], ['Awaiting review', summary.data?.needs_review, 'eye'], ['Confirmed', summary.data ? summary.data.by_status.applied || 0 : undefined, 'check-circle'], ['Interviews', summary.data ? summary.data.by_outcome.interview || 0 : undefined, 'mail']].map(([label, count, icon]) => <Card key={String(label)}><div className="stat-label"><span>{label}</span><Icon name={String(icon)} size={17}/></div><strong className="stat-number">{typeof count === 'number' ? count : '—'}</strong></Card>)}
    </div>
    <ApplicationSchedule/>
    <div className="application-toolbar"><div className="application-tabs" role="group" aria-label="Application status">{tabs.map(([value, label]) => <button key={value} className={status === value ? 'active' : ''} onClick={() => chooseStatus(value)} aria-pressed={status === value}>{label}{summary.data ? <span>{value ? summary.data.by_status[value] || 0 : summary.data.total}</span> : null}</button>)}</div><label className="outcome-filter"><span className="sr-only">Filter hiring outcome</span><select value={outcome} onChange={event => { setOutcome(event.target.value); setPage(0); }}><option value="">All outcomes</option>{['interview', 'offer', 'rejected', 'withdrawn'].map(value => <option key={value} value={value}>{human(value)}</option>)}</select></label></div>
    {list.error || summary.error ? <div className="component-error" role="alert">{list.error || summary.error}<Button variant="ghost" size="sm" onClick={update}>Try again</Button></div> : null}
    <Card className="applications-list">
      {list.loading && !list.data ? <div className="component-loading"><Spinner/><span>Loading your applications…</span></div> : list.data?.items.length ? <><div className="list-heading"><span>JOB & COMPANY</span><span>STATUS</span></div>{list.data.items.map(app => <ApplicationRow key={app.id} app={app} onOpen={() => setSelected(app.id)}/>)}</> : !list.error ? <EmptyState icon="briefcase" title={status || outcome ? 'No applications in this view' : 'Your next chapter starts here'} description={status || outcome ? 'Change the filters to see your other applications.' : 'Find a cybersecurity role and prepare an application, or set up automatic discovery in your profile.'} action={<Button onClick={() => navigate('search')}>Explore jobs<Icon name="arrow-right" size={16}/></Button>}/> : null}
    </Card>
    {(list.data?.total || 0) > 20 ? <div className="application-pagination"><span>{page * 20 + 1}–{Math.min((page + 1) * 20, list.data?.total || 0)} of {list.data?.total}</span><div><Button variant="secondary" size="sm" disabled={page === 0 || list.loading} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={(page + 1) * 20 >= (list.data?.total || 0) || list.loading} onClick={() => setPage(page + 1)}>Next</Button></div></div> : null}
    {selected ? <ApplicationDetail id={selected} onClose={() => setSelected(null)} onChange={update}/> : null}
    <style jsx>{`
      .applications-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:30px}.eyebrow{color:var(--accent,#6258e8);font-size:0.625rem;font-weight:700;letter-spacing:.14em;margin:0 0 10px}h1{font-size:1.875rem;font-weight:600;letter-spacing:-1px;margin:0 0 9px}.view-description{color:var(--muted,#777b8d);font-size:0.875rem;margin:0}.application-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:30px}.stat-label{display:flex;justify-content:space-between;gap:10px;color:var(--muted,#777b8d);font-size:0.75rem}.stat-number{display:block;font-size:1.875rem;line-height:1;margin-top:16px;font-weight:600;letter-spacing:-1px}.application-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.application-tabs{display:flex;gap:4px;overflow:auto;min-width:0;padding:2px 0}.application-tabs button{border:0;border-radius:8px;padding:10px 12px;background:none;color:var(--muted,#777b8d);font:inherit;font-size:0.75rem;white-space:nowrap;cursor:pointer}.application-tabs button.active{background:var(--accent-soft,#eeebff);color:var(--accent,#6258e8);font-weight:600}.application-tabs span{margin-left:6px;font-size:0.625rem;opacity:.75}.outcome-filter select{font:inherit;font-size:0.75rem;min-width:125px;padding:10px;border:1px solid var(--border,#e7e8ee);border-radius:8px;background:var(--surface,#fff);color:inherit}.list-heading{display:flex;justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--border,#e7e8ee);color:var(--muted,#777b8d);font-size:0.5625rem;letter-spacing:.12em;font-weight:600}.list-heading span:last-child{margin-right:103px}.component-loading{display:flex;align-items:center;justify-content:center;gap:12px;padding:60px 20px;color:var(--muted,#777b8d);font-size:0.8125rem}.component-error{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:0.8125rem;border:1px solid #efc6c0;border-radius:10px;padding:12px 16px;margin-bottom:16px;color:var(--text,#22253c);background:var(--surface,#fff)}.application-pagination{display:flex;align-items:center;justify-content:space-between;margin-top:16px;font-size:0.75rem;color:var(--muted,#777b8d)}.application-pagination>div{display:flex;gap:8px}.applications-view :global(.applications-list){padding:0;overflow:hidden}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:700px){.application-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.applications-head{align-items:flex-start;margin-bottom:23px}h1{font-size:1.6875rem}.application-toolbar{align-items:flex-start;flex-direction:column}.application-tabs{width:100%}.outcome-filter{align-self:flex-end}.list-heading span:last-child{display:none}.view-description{line-height:1.5}}
    `}</style>
  </section>;
}

function AnswerInput({ name, value, onChange }: { name: string; value: unknown; onChange: (value: unknown) => void }) {
  const [newCountry, setNewCountry] = useState('');
  const [authorization, setAuthorization] = useState('');
  if (name === 'work_authorization') {
    const countries: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return <div className="authorization-fields">{Object.entries(countries).map(([country, allowed]) => <Field key={country} label={`Work authorization · ${country}`}><select value={allowed === true ? 'true' : allowed === false ? 'false' : ''} onChange={event => onChange({ ...countries, [country]: event.target.value === '' ? null : event.target.value === 'true' })}><option value="">Not confirmed</option><option value="true">Authorized</option><option value="false">Not authorized</option></select></Field>)}<Field label="Country code"><input value={newCountry} maxLength={2} placeholder="US, GB, NG…" onChange={event => setNewCountry(event.target.value.toUpperCase())}/></Field><Field label="Are you authorized to work there?"><select value={authorization} onChange={event => setAuthorization(event.target.value)}><option value="">Choose an answer</option><option value="true">Yes</option><option value="false">No</option></select></Field><Button variant="secondary" size="sm" disabled={!/^[A-Z]{2}$/.test(newCountry) || !authorization} onClick={() => { onChange({ ...countries, [newCountry]: authorization === 'true' }); setNewCountry(''); setAuthorization(''); }}>Add country answer</Button><style jsx>{`.authorization-fields{display:flex;flex-direction:column;gap:10px}`}</style></div>;
  }
  if (typeof value === 'boolean' || name === 'sponsorship_required') return <select value={value === true ? 'true' : value === false ? 'false' : ''} onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'true')}><option value="">Not provided</option><option value="true">Yes</option><option value="false">No</option></select>;
  if (name === 'security_clearance') return <select value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value || null)}><option value="">Not provided</option>{['none', 'public_trust', 'confidential', 'secret', 'top_secret', 'ts_sci'].map(item => <option key={item} value={item}>{human(item)}</option>)}</select>;
  if (typeof value === 'number' || name === 'salary_expectation') return <input type="number" min="0" step="any" value={typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))}/>;
  return <textarea rows={name.includes('why') || name.includes('experience') ? 3 : 1} value={typeof value === 'string' ? value : value === undefined || value === null ? '' : valueText(value)} maxLength={20000} onChange={event => onChange(event.target.value)}/>;
}

function ApplicationDetail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { request, notify, refresh } = useWorkspace();
  const detail = useLoad<Application>(`/applications/${id}`);
  const events = useLoad<{ items: AppEvent[] }>(`/applications/${id}/events?limit=100`);
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [coverLetter, setCoverLetter] = useState('');
  const [editVersion, setEditVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [extraEvents, setExtraEvents] = useState<AppEvent[]>([]);
  const [endOfEvents, setEndOfEvents] = useState(false);
  const reloadRef = useRef(() => {});
  reloadRef.current = () => { detail.reload(); events.reload(); };
  const app = detail.data;
  useEffect(() => {
    if (!app || !activeStates.has(app.status) || editing) return;
    const timer = setInterval(() => reloadRef.current(), 5000);
    return () => clearInterval(timer);
  }, [app?.status, editing]);
  const changed = () => { reloadRef.current(); onChange(); refresh(); };
  const perform = async (action: string, body?: Record<string, unknown>, method = 'POST') => {
    if (!app) return;
    setBusy(action); setError('');
    try {
      await request<Application>(`/applications/${id}${action === 'save' ? '' : `/${action}`}`, { method: action === 'save' ? 'PATCH' : method, body: body || (action === 'reconcile' ? undefined : { expected_version: app.version }) });
      if (action === 'save') setEditing(false);
      if (action === 'outcome') setOutcome('');
      notify(action === 'approve' ? 'Approved and queued. Submission still requires employer confirmation.' : action === 'reconcile' ? 'Receipt lookup queued. The application will not be resubmitted.' : action === 'save' ? 'Draft saved. Review the updated answers before approval.' : action === 'outcome' ? 'Hiring outcome recorded.' : action === 'cancel' ? 'Application cancelled.' : 'Confirmed failure queued for retry.', 'success');
      changed();
    } catch (cause) { setError(errorText(cause)); detail.reload(); } finally { setBusy(''); }
  };
  const beginEditing = () => { if (!app) return; setAnswers(structuredClone(app.answers || {})); setCoverLetter(app.cover_letter || ''); setEditVersion(app.version); setEditing(true); setError(''); };
  const allEvents = Array.from(new Map([...(events.data?.items || []), ...extraEvents].map(item => [item.id, item])).values()).sort((a, b) => a.sequence - b.sequence);
  const moreEvents = async () => { setBusy('events'); try { const next = await request<{ items: AppEvent[] }>(`/applications/${id}/events?limit=100&offset=${allEvents.length}`); setExtraEvents(previous => [...previous, ...next.items]); setEndOfEvents(next.items.length < 100); } catch (cause) { setError(errorText(cause)); } finally { setBusy(''); } };
  const fields = app ? Array.from(new Set([...Object.keys(editing ? answers : app.answers || {}), ...app.missing_fields])).filter(name => !['resume_text', 'cover_letter', 'unsupported_form_schema'].includes(name)) : [];
  return <Modal open onClose={onClose} title="Application details" wide>
    {detail.loading && !app ? <div className="detail-loading"><Spinner/>Loading application…</div> : null}
    {detail.error || error ? <div className="detail-error" role="alert">{error || detail.error}<Button variant="ghost" size="sm" onClick={() => detail.reload()}>Refresh details</Button></div> : null}
    {app ? <>
      <DetailJob app={app}/>
      <ApplicationHold application={app} onUndone={()=>{changed();notify("Application undone before processing.");}} onExpired={()=>detail.reload()}/>
      {app.next_action && <p className="detail-note">{app.next_action.label}</p>}
      <div className="detail-badges"><Status app={app}/><Badge>{app.mode === 'automatic' ? 'Automatic mode' : 'Review mode'}</Badge>{app.is_demo ? <Badge tone="info">Simulated application</Badge> : null}</div>
      {app.is_demo ? <p className="detail-note">This job uses a fictional employer. Its confirmation represents a local demo application.</p> : null}
      {app.error_message ? <div className="attention-note"><Icon name="alert" size={18}/><p>{app.error_message}</p></div> : null}
      {app.status === 'uncertain' ? <div className="attention-note"><Icon name="shield" size={18}/><p>The employer may have received this application. Check its receipt before attempting another submission.</p></div> : null}
      {app.missing_fields.length ? <p className="missing-note">Required information: {app.missing_fields.map(human).join(', ')}.</p> : null}
      {app.match?.blockers?.length ? <ul className="blocker-list">{app.match.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul> : null}
      <div className="detail-actions">
        {app.status === 'needs_review' ? <Button loading={busy === 'approve'} disabled={Boolean(busy) || editing || Boolean(app.missing_fields.length)} onClick={() => perform('approve')}><Icon name="check" size={17}/>Approve application</Button> : null}
        {editableStates.has(app.status) && !editing ? <Button variant="secondary" disabled={Boolean(busy)} onClick={beginEditing}><Icon name="file" size={16}/>Edit answers</Button> : null}
        {app.status === 'failed' ? <Button disabled={Boolean(busy)} loading={busy === 'retry'} onClick={() => perform('retry')}>Retry confirmed failure</Button> : null}
        {app.status === 'uncertain' ? <Button disabled={Boolean(busy) || app.error_code === 'reconciliation_requested'} loading={busy === 'reconcile'} onClick={() => perform('reconcile')}><Icon name="refresh" size={16}/>{app.error_code === 'reconciliation_requested' ? 'Receipt lookup queued' : 'Check employer receipt'}</Button> : null}
        {cancellableStates.has(app.status) ? <Button variant="ghost" disabled={Boolean(busy) || editing} loading={busy === 'cancel'} onClick={() => perform('cancel')}>Cancel application</Button> : null}
      </div>
      {app.status === 'applied' ? <div className="confirmed-details"><div><span>Employer confirmation</span><strong>{app.confirmation_id || 'Confirmed'}</strong></div><div><span>Confirmed on</span><strong>{date(app.submitted_at, true)}</strong></div><div className="outcome-editor"><Field label="Hiring outcome"><select value={outcome || app.outcome || ''} onChange={event => setOutcome(event.target.value)}><option value="">Choose an outcome</option>{['interview', 'offer', 'rejected', 'withdrawn'].map(item => <option key={item} value={item}>{human(item)}</option>)}</select></Field><Button variant="secondary" size="sm" disabled={!outcome || Boolean(busy)} loading={busy === 'outcome'} onClick={() => perform('outcome', { outcome, expected_version: app.version }, 'PATCH')}>Record outcome</Button></div></div> : null}
      <section className="detail-section"><div className="section-title"><h3>Application answers</h3><span>Version {editing ? editVersion : app.version}</span></div>{fields.length ? <div className="answers-grid">{fields.map(name => editing ? name === 'work_authorization' ? <div key={name}><p className="detail-note">Work authorization · declare each country explicitly.</p><AnswerInput name={name} value={answers[name]} onChange={value => setAnswers(previous => ({ ...previous, [name]: value }))}/></div> : <Field key={name} label={human(name)} hint={app.missing_fields.includes(name) ? 'Required by this employer' : undefined}><AnswerInput name={name} value={answers[name]} onChange={value => setAnswers(previous => ({ ...previous, [name]: value }))}/></Field> : <div key={name} className="answer-value"><span>{human(name)}</span><p>{valueText(app.answers?.[name])}</p></div>)}</div> : <p className="detail-note">Answers will appear after the worker prepares this application.</p>}
        <div className="cover-letter">{editing ? <Field label="Cover letter" hint="Use your own experience and claims. This text is never generated automatically."><textarea rows={6} maxLength={20000} value={coverLetter} onChange={event => setCoverLetter(event.target.value)}/></Field> : app.cover_letter ? <><h4>Cover letter</h4><p className="plain-text">{app.cover_letter}</p></> : null}</div>
        {editing ? <div className="detail-actions"><Button disabled={Boolean(busy)} loading={busy === 'save'} onClick={() => perform('save', { answers, cover_letter: coverLetter, expected_version: editVersion })}>Save draft</Button><Button variant="ghost" disabled={Boolean(busy)} onClick={() => setEditing(false)}>Discard edits</Button></div> : null}
      </section>
      {app.resume_snapshot ? <details className="resume-snapshot"><summary><Icon name="file" size={16}/>{app.resume_snapshot.title || 'Captured résumé'}<span>Résumé version {app.resume_snapshot.version || 1}</span></summary><p className="detail-note">Captured on {date(app.resume_snapshot.captured_at, true)}. Later résumé edits do not change this application.</p><pre>{app.resume_snapshot.text || 'No résumé text available.'}</pre></details> : null}
      <section className="detail-section"><div className="section-title"><h3>Activity</h3><span>Recorded in order</span></div>{events.error ? <p className="detail-error" role="alert">{events.error}</p> : null}{events.loading && !events.data ? <Spinner/> : <ol className="application-timeline">{allEvents.map(item => <li key={item.id}><span className="event-dot"/><div><strong>{human(item.event_type)}</strong><p>{item.message}</p><time>{date(item.created_at, true)}</time></div></li>)}</ol>}{allEvents.length >= 100 && !endOfEvents ? <Button variant="ghost" size="sm" loading={busy === 'events'} disabled={Boolean(busy)} onClick={moreEvents}>Load more activity</Button> : null}</section>
    </> : null}
    <style jsx>{`
      .detail-loading{display:flex;gap:12px;padding:24px;color:var(--muted,#777b8d)}.detail-error{padding:12px;border-radius:9px;border:1px solid #efc6c0;margin-bottom:14px;font-size:0.8125rem;display:flex;align-items:center;justify-content:space-between;gap:10px}.detail-badges{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 12px}.detail-note{font-size:0.75rem;line-height:1.6;color:var(--muted,#777b8d)}.attention-note{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--border,#e7e8ee);border-radius:9px;background:var(--accent-soft,#f5f3ff);margin:12px 0}.attention-note p{margin:0;font-size:0.75rem;line-height:1.6}.attention-note :global(svg){flex-shrink:0;margin-top:1px}.missing-note,.blocker-list{font-size:0.75rem;line-height:1.6;color:var(--muted,#777b8d)}.detail-actions{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.detail-section{border-top:1px solid var(--border,#e7e8ee);padding-top:21px;margin-top:23px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.section-title h3{font-size:0.875rem;font-weight:600;margin:0}.section-title>span{font-size:0.6875rem;color:var(--muted,#777b8d)}.answers-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.answer-value>span{font-size:0.6875rem;color:var(--muted,#777b8d)}.answer-value p{margin:6px 0 0;font-size:0.8125rem;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.cover-letter{margin-top:19px}.cover-letter h4{font-size:0.75rem;margin:0 0 8px}.plain-text{white-space:pre-wrap;font-size:0.8125rem;line-height:1.75;overflow-wrap:anywhere}.resume-snapshot{padding:16px;margin-top:23px;border:1px solid var(--border,#e7e8ee);border-radius:10px}.resume-snapshot summary{display:flex;gap:8px;align-items:center;font-size:0.75rem;font-weight:600;cursor:pointer}.resume-snapshot summary span{margin-left:auto;font-size:0.625rem;font-weight:400;color:var(--muted,#777b8d)}.resume-snapshot pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:0.75rem;line-height:1.7;max-height:250px;overflow:auto}.application-timeline{padding:0;margin:0;list-style:none}.application-timeline li{display:flex;gap:13px;position:relative;padding-bottom:22px}.application-timeline li:not(:last-child):before{position:absolute;content:'';left:4px;top:12px;bottom:0;width:1px;background:var(--border,#e7e8ee)}.event-dot{flex-shrink:0;width:9px;height:9px;margin-top:5px;border-radius:50%;background:var(--accent,#6258e8)}.application-timeline strong{font-size:0.75rem;font-weight:600}.application-timeline p{font-size:0.75rem;line-height:1.6;margin:4px 0;color:var(--muted,#777b8d)}.application-timeline time{font-size:0.625rem;color:var(--muted,#777b8d)}.confirmed-details{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:17px;border-radius:10px;background:var(--accent-soft,#f5f3ff)}.confirmed-details>div>span{font-size:0.625rem;display:block;color:var(--muted,#777b8d);margin-bottom:6px}.confirmed-details strong{font-size:0.75rem;font-weight:500;overflow-wrap:anywhere}.outcome-editor{grid-column:1/-1;display:flex;align-items:flex-end;gap:10px}.outcome-editor :global(.field){flex:1}select,input,textarea{width:100%;border:1px solid var(--border,#e7e8ee);border-radius:8px;background:var(--surface,#fff);color:inherit;padding:10px;font:inherit;font-size:0.8125rem;resize:vertical}select:focus,input:focus,textarea:focus{outline:2px solid var(--accent,#6258e8);outline-offset:1px}@media(max-width:560px){.answers-grid,.confirmed-details{grid-template-columns:1fr}.section-title>span{font-size:0.625rem}.outcome-editor{align-items:stretch;flex-direction:column}.resume-snapshot summary{flex-wrap:wrap}.resume-snapshot summary span{margin-left:0;width:100%}}
    `}</style>
  </Modal>;
}

function DetailJob({ app }: { app: Application }) {
  const job = useLoad<Job>(`/jobs/${app.job_id}`);
  return <div className="detail-job"><span className="detail-company-mark"><Icon name="building" size={24}/></span><div><h3>{job.data?.title || 'Cybersecurity application'}</h3><p>{job.data?.company || 'Loading employer…'}{job.data?.location ? ` · ${job.data.location}` : ''}</p>{job.error ? <p role="alert">Job details unavailable: {job.error}</p> : null}</div><style jsx>{`.detail-job{display:flex;align-items:center;gap:14px}.detail-company-mark{display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:var(--accent-soft,#eeebff);color:var(--accent,#6258e8);flex-shrink:0}.detail-job h3{font-size:1.1875rem;font-weight:600;letter-spacing:-.3px;margin:0 0 7px}.detail-job p{font-size:0.75rem;color:var(--muted,#777b8d);margin:0;line-height:1.5}`}</style></div>;
}
