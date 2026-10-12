'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { Badge, Button, EmptyState, ErrorNotice, Field, Icon, Modal, Spinner } from '@/components/ui';

export interface MatchReport {
  score: number;
  score_kind?: string;
  eligible: boolean;
  matched_skills: string[];
  missing_skills: string[];
  missing_certifications: string[];
  reasons: string[];
  blockers: string[];
  skills_basis?: string;
  preference_checks?: { preference: string; matches: boolean | null; reason: string }[];
  eligibility_checks?: { requirement: string; status: string; reason: string }[];
}

export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  remote?: boolean;
  employment_type?: string;
  level?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string;
  source?: string;
  source_url?: string;
  apply_url?: string;
  connector_key?: string;
  is_demo?: boolean;
  active?: boolean;
  expires_at?: string | null;
  decision?: 'saved' | 'passed' | null;
  required_skills?: string[];
  required_certifications?: string[];
  attributes?: { workplace_type?: string; country?: string; salary_interval?: string; mandatory_eligibility?: Record<string, unknown>; skills_basis?: string };
  match?: MatchReport;
}

interface ResumeChoice { id: string; title: string; reviewed: boolean; is_main: boolean; version: number }
interface ResumeList { items: ResumeChoice[]; total: number }
interface ProfileStatus { confirmed: boolean }
interface QueuedApplication { id: string; status: string; is_demo: boolean }

export function label(value?: string) {
  if (!value || value === 'unspecified') return 'Not specified';
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function salaryLabel(job: Job) {
  if (job.salary_min == null && job.salary_max == null) return 'Salary not listed';
  const currency = /^[A-Z]{3}$/.test(job.currency ?? '') ? job.currency! : 'USD';
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0, notation: 'compact' });
  const minimum = job.salary_min != null ? formatter.format(job.salary_min) : '';
  const maximum = job.salary_max != null ? formatter.format(job.salary_max) : '';
  const amount = minimum && maximum ? `${minimum}–${maximum}` : minimum ? `From ${minimum}` : `Up to ${maximum}`;
  const interval = job.attributes?.salary_interval ?? 'year';
  return `${amount}${interval !== 'unspecified' ? ` / ${interval}` : ''}`;
}

export function CompanyMark({ company, large = false }: { company: string; large?: boolean }) {
  const tones = ['#e8e8ff', '#e5f1ec', '#f6eadf', '#e5edf7', '#f3e5ef'];
  const index = [...company].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % tones.length;
  const initials = company.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: large ? 64 : 46, height: large ? 64 : 46, flexShrink: 0, borderRadius: large ? 20 : 15, background: tones[index], color: '#393760', fontSize: large ? 22 : 15, fontWeight: 750, letterSpacing: '-.04em', border: '1px solid rgba(30,30,60,.035)' }}>{initials || 'CO'}</span>;
}

function externalUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function JobDetail({ job, onClose, onChanged }: { job: Job; onClose: () => void; onChanged?: () => void }) {
  const { request, notify, navigate, refresh } = useWorkspace();
  const fit = useLoad<MatchReport>(`/jobs/${job.id}/match`);
  const resumes = useLoad<ResumeList>('/resumes?limit=100');
  const profile = useLoad<ProfileStatus>('/profiles/me');
  const [tab, setTab] = useState<'overview' | 'fit'>('overview');
  const [selectedResume, setSelectedResume] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState(job.decision ?? null);
  const [queued, setQueued] = useState<QueuedApplication | null>(null);
  const [expanded, setExpanded] = useState(false);
  const queueKey = useRef('');
  const report = fit.data ?? job.match;
  const selected = resumes.data?.items.find(item => item.id === selectedResume);
  const link = externalUrl(job.source_url || job.apply_url);
  const expired = job.expires_at ? new Date(job.expires_at).getTime() <= Date.now() : false;

  useEffect(() => { queueKey.current = ''; }, [selectedResume]);

  useEffect(() => {
    if (selectedResume || !resumes.data?.items.length) return;
    const choices = resumes.data.items;
    const preferred = choices.find(item => item.is_main && item.reviewed) ?? choices.find(item => item.reviewed) ?? choices.find(item => item.is_main) ?? choices[0];
    setSelectedResume(preferred.id);
  }, [resumes.data, selectedResume]);

  async function decide(next: 'saved' | 'passed') {
    setPending(next); setError(null);
    try {
      if (next === decision) {
        await request(`/jobs/${job.id}/decision`, { method: 'DELETE' });
        setDecision(null); notify(next === 'saved' ? 'Job removed from saved.' : 'Job returned to your opportunities.');
      } else {
        await request(`/jobs/${job.id}/${next === 'saved' ? 'save' : 'pass'}`, { method: 'POST' });
        setDecision(next); notify(next === 'saved' ? 'Job saved for later.' : 'Job moved to passed.');
      }
      onChanged?.(); refresh();
      if (next === 'passed') onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your job decision could not be saved.'); }
    finally { setPending(''); }
  }

  async function queueApplication() {
    if (!selectedResume) return;
    setPending('queue'); setError(null);
    if (!queueKey.current) queueKey.current = `review-${job.id}-${crypto.randomUUID()}`;
    try {
      const application = await request<QueuedApplication>('/applications', { method: 'POST', body: JSON.stringify({ job_id: job.id, resume_id: selectedResume, mode: 'review', idempotency_key: queueKey.current }) });
      setQueued(application); refresh(); onChanged?.();
      notify('Application queued for preparation. You can review it in Applications.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your application could not be queued.'); }
    finally { setPending(''); }
  }

  return <Modal open onClose={onClose} title="Job details" wide>
    <div className="detail-shell">
      <header className="role-heading">
        <CompanyMark company={job.company} large />
        <div className="role-heading-copy"><span className="company-name">{job.company}</span><h2>{job.title}</h2><div className="role-meta"><span><Icon name="map-pin" size={15} />{job.location || 'Location not listed'}</span><span><Icon name="globe" size={15} />{job.remote ? 'Remote' : label(job.attributes?.workplace_type)}</span></div></div>
      </header>
      <div className="role-badges"><Badge tone="info">{salaryLabel(job)}</Badge><Badge>{label(job.employment_type)}</Badge>{job.level && job.level !== 'unspecified' ? <Badge>{label(job.level)}</Badge> : null}{job.is_demo ? <Badge tone="warning">Demo role · simulated application</Badge> : null}</div>
      <div className="detail-columns">
        <div className="role-content">
          <div className="detail-tabs" role="tablist" aria-label="Job information"><button type="button" role="tab" aria-selected={tab === 'overview'} aria-controls="role-overview" onClick={() => setTab('overview')} className={tab === 'overview' ? 'selected' : ''}>Overview</button><button type="button" role="tab" aria-selected={tab === 'fit'} aria-controls="role-fit" onClick={() => setTab('fit')} className={tab === 'fit' ? 'selected' : ''}><Icon name="shield-check" size={16} /> Your fit report {report ? <span>{report.score}</span> : null}</button></div>
          {tab === 'overview' ? <section id="role-overview" role="tabpanel" className="overview-panel">
            <h3>About this opportunity</h3>
            <p className="description">{!job.description ? 'A description has not been provided. Check the original job listing for details.' : expanded || job.description.length < 1800 ? job.description : `${job.description.slice(0, 1800).trim()}…`}</p>
            {job.description?.length >= 1800 ? <button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read full description'} <Icon name="chevron-down" size={15} /></button> : null}
            {!!job.required_skills?.length ? <div className="detail-section"><h3>{job.attributes?.skills_basis === 'job_description_mentions' ? 'Skills mentioned in the listing' : 'Listed skills'}</h3><div className="skill-list">{job.required_skills.map(skill => <span className="skill-pill" key={skill}>{skill}</span>)}</div></div> : null}
            {!!job.required_certifications?.length ? <div className="detail-section"><h3>Required certifications</h3><div className="skill-list">{job.required_certifications.map(skill => <span className="skill-pill" key={skill}>{skill}</span>)}</div></div> : null}
            {link ? <a className="original-link" href={link} target="_blank" rel="noopener noreferrer">View the original listing <Icon name="external-link" size={15} /></a> : null}
          </section> : <section id="role-fit" role="tabpanel" className="fit-panel">
            {!report && fit.loading ? <div className="fit-loading"><Spinner /><span>Comparing your profile with this role…</span></div> : !report ? <EmptyState title="Fit report unavailable" description={fit.error || 'Please try loading this report again.'} icon="shield" action={<Button variant="secondary" onClick={fit.reload}>Try again</Button>} /> : <>
              <div className="fit-summary"><div className="fit-ring" style={{ '--fit-progress': `${Math.max(0, Math.min(100, report.score))}%` } as CSSProperties}><div><strong>{report.score}</strong><span>of 100</span></div></div><div><span className="mini-label">YOUR FIT ESTIMATE</span><h3>{report.score >= 80 ? 'A promising match' : report.score >= 60 ? 'Worth a closer look' : 'A few gaps to review'}</h3><p>Skills, preferred roles and job requirements, compared with your profile.</p></div></div>
              <p className="fit-note">A heuristic estimate, not an ATS score or hiring probability.</p>
              <div className="detail-section"><div className="section-title"><h3>Skills you bring</h3><Badge tone="success">{report.matched_skills?.length ?? 0} matched</Badge></div><div className="skill-list">{report.matched_skills?.length ? report.matched_skills.map(skill => <span className="skill-pill matched" key={skill}><Icon name="check" size={13} />{skill}</span>) : <p className="muted-small">No skill matches are confirmed yet.</p>}</div></div>
              {!!report.missing_skills?.length ? <div className="detail-section"><h3>Skills to review</h3><p className="muted-small">Add supporting experience only when it is true. Otherwise, keep these as skill gaps.</p><div className="skill-list">{report.missing_skills.map(skill => <span className="skill-pill gap" key={skill}>{skill}</span>)}</div></div> : null}
              {!!report.missing_certifications?.length ? <div className="fit-warning"><Icon name="alert" size={18} /><div><strong>Certification requirements</strong><p>{report.missing_certifications.join(', ')} {report.missing_certifications.length === 1 ? 'is' : 'are'} missing from your profile. Confirm credentials you actually hold.</p></div></div> : null}
              {!!report.eligibility_checks?.length ? <div className="detail-section"><h3>Eligibility checks</h3><div className="check-list">{report.eligibility_checks.map((check, index) => <div className="check-row" key={`${check.requirement}-${index}`}><span>{check.reason}</span><Badge tone={check.status === 'met' ? 'success' : 'warning'}>{check.status === 'met' ? 'Met' : check.status === 'unknown' ? 'Confirm' : 'Gap'}</Badge></div>)}</div></div> : null}
              {!!report.preference_checks?.length ? <div className="detail-section"><h3>Your saved preferences</h3><div className="check-list">{report.preference_checks.map((check, index) => <div className="check-row" key={`${check.preference}-${index}`}><span>{check.reason}</span><Badge tone={check.matches === true ? 'success' : 'warning'}>{check.matches === true ? 'Matches' : check.matches === null ? 'Unknown' : 'Outside'}</Badge></div>)}</div><p className="muted-small">Automatic applying requires every saved preference to be confirmed. You can review a role here before deciding.</p></div> : null}
              {!!report.blockers?.length ? <div className="fit-warning"><Icon name="alert" size={18} /><div><strong>Before you apply</strong><ul>{report.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div></div> : null}
              <details className="fit-reasons"><summary>How this estimate was calculated <Icon name="chevron-down" size={15} /></summary><ul>{report.reasons?.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
            </>}
          </section>}
        </div>
        <aside className="application-panel">
          {queued ? <div className="queued-panel" aria-live="polite"><div className="queued-icon"><Icon name="check" size={24} /></div><h3>Your draft is in the queue</h3><p>We’ll prepare the application for your review. You can follow its progress in Applications.</p>{job.is_demo ? <p className="muted-small">This role uses a simulated employer. No real application is sent.</p> : null}<Button fullWidth onClick={() => { onClose(); navigate('applications'); }}>Open Applications <Icon name="arrow-right" size={17} /></Button></div> : <>
            <div className="application-eyebrow"><Icon name="file-text" size={17} /><span>YOUR NEXT STEP</span></div><h3>Make it your next move.</h3><p className="panel-intro">Choose a résumé. We’ll prepare a draft for you to review before submission.</p>
            {resumes.loading ? <div className="resume-loading"><Spinner />Loading your résumés…</div> : resumes.error ? <ErrorNotice error={resumes.error} /> : resumes.data?.items.length ? <Field label="Use this résumé"><select className="field-input" value={selectedResume} onChange={event => setSelectedResume(event.target.value)} aria-label="Résumé for this application">{resumes.data.items.map(item => <option key={item.id} value={item.id}>{item.title}{item.is_main ? ' · Main' : ''}{!item.reviewed ? ' · Needs review' : ''}</option>)}</select></Field> : <div className="setup-note"><Icon name="upload" size={20} /><p>Add your résumé to prepare your first application.</p><Button variant="secondary" fullWidth onClick={() => { onClose(); navigate('profile:resume'); }}>Add a résumé</Button></div>}
            {!profile.loading && !profile.data?.confirmed ? <div className="setup-note"><p>Your profile needs a quick review first.</p><button type="button" className="text-button" onClick={() => { onClose(); navigate('profile'); }}>Review my profile <Icon name="arrow-right" size={14} /></button></div> : null}
            {selected && !selected.reviewed ? <div className="setup-note"><p>Confirm the facts in this résumé before preparing applications.</p><button type="button" className="text-button" onClick={() => { onClose(); navigate('profile:resume'); }}>Review résumé <Icon name="arrow-right" size={14} /></button></div> : null}
            {job.active === false || expired ? <ErrorNotice error="This job is no longer accepting applications." /> : null}
            {profile.error ? <ErrorNotice error={profile.error} /> : null}
            {job.connector_key === 'unsupported' ? <div className="submission-note"><Icon name="help" size={16} /><p>Preparation is available here. Submit this role on the employer’s website.</p></div> : job.is_demo ? <div className="submission-note"><Icon name="shield" size={16} /><p>Demo role. Employer submission is simulated.</p></div> : null}
            <ErrorNotice error={error} />
            <Button fullWidth loading={pending === 'queue'} disabled={!!pending || !selected?.reviewed || !profile.data?.confirmed || profile.loading || job.active === false || expired} onClick={queueApplication}>Prepare for review <Icon name="arrow-right" size={17} /></Button>
            <p className="review-promise"><Icon name="shield-check" size={14} />You review the draft before it moves forward.</p>
          </>}
          <div className="secondary-actions"><Button variant="secondary" loading={pending === 'saved'} disabled={!!pending} onClick={() => decide('saved')}><Icon name="bookmark" size={16} />{decision === 'saved' ? 'Saved' : 'Save job'}</Button><Button variant="ghost" loading={pending === 'passed'} disabled={!!pending} onClick={() => decide('passed')}>Pass</Button></div>
          {queued && error ? <ErrorNotice error={error} /> : null}
        </aside>
      </div>
    </div>
    <style jsx>{`
      .detail-shell { color: #262537; }
      .role-heading { display: flex; gap: 18px; align-items: center; padding: 4px 0 18px; }
      .role-heading-copy { min-width: 0; }
      .company-name { font-size: 13px; color: #74717d; font-weight: 600; }
      .role-heading h2 { margin: 5px 0 10px; font-size: clamp(23px, 3vw, 31px); letter-spacing: -.045em; line-height: 1.15; font-weight: 700; }
      .role-meta { display: flex; flex-wrap: wrap; gap: 12px; color: #777481; font-size: 12px; }
      .role-meta span, .original-link, .text-button { display: inline-flex; align-items: center; gap: 6px; }
      .role-badges { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 28px; }
      .detail-columns { display: grid; grid-template-columns: minmax(0, 1fr) 285px; gap: 26px; align-items: start; }
      .detail-tabs { display: flex; border-bottom: 1px solid #e9e7ed; gap: 22px; margin-bottom: 26px; }
      .detail-tabs button { display: flex; align-items: center; gap: 6px; border: 0; background: transparent; color: #86818d; padding: 0 0 15px; font: inherit; font-size: 13px; font-weight: 600; border-bottom: 2px solid transparent; cursor: pointer; }
      .detail-tabs button.selected { color: #6153ba; border-color: #6153ba; }
      .detail-tabs button span { background: #eeeafa; padding: 2px 6px; border-radius: 6px; font-size: 11px; }
      h3 { font-size: 15px; font-weight: 650; margin: 0 0 12px; letter-spacing: -.02em; }
      .description { white-space: pre-wrap; line-height: 1.8; font-size: 13px; color: #6c6876; margin: 0 0 14px; overflow-wrap: anywhere; }
      .detail-section { margin-top: 28px; }
      .skill-list { display: flex; flex-wrap: wrap; gap: 7px; }
      .skill-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; line-height: 1.4; padding: 6px 10px; background: #f3f1f6; border-radius: 7px; color: #696275; }
      .skill-pill.matched { background: #edf6ef; color: #437758; }
      .skill-pill.gap { background: #fcf3e6; color: #a17a37; }
      .original-link { font-size: 12px; font-weight: 650; color: #6555b8; margin-top: 28px; text-decoration: none; }
      .text-button { border: 0; background: none; color: #6555b8; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; padding: 0; }
      .application-panel { border: 1px solid #e9e5ef; border-radius: 19px; background: #fbfafc; padding: 22px; }
      .application-eyebrow { display: flex; gap: 7px; align-items: center; color: #8576b8; font-size: 9px; letter-spacing: .12em; font-weight: 700; margin-bottom: 15px; }
      .application-panel h3 { font-size: 21px; line-height: 1.25; letter-spacing: -.045em; margin-bottom: 10px; }
      .panel-intro, .queued-panel p { color: #827b8c; font-size: 12px; line-height: 1.7; margin: 0 0 21px; }
      .resume-loading { display: flex; gap: 9px; align-items: center; font-size: 12px; color: #777; padding: 15px 0; }
      .setup-note { border: 1px solid #ece5d5; background: #fffbf2; padding: 13px; border-radius: 10px; margin: 12px 0; color: #977548; }
      .setup-note p { font-size: 11px; line-height: 1.65; margin: 4px 0 9px; }
      .submission-note { display: flex; gap: 8px; align-items: flex-start; margin: 16px 0; color: #8c829f; }
      .submission-note p { font-size: 10px; line-height: 1.65; margin: 0; }
      .submission-note :global(svg) { flex-shrink: 0; margin-top: 1px; }
      .review-promise { display: flex; align-items: flex-start; gap: 5px; font-size: 9px; color: #9b93a7; line-height: 1.6; margin: 12px 0 0; }
      .review-promise :global(svg) { flex-shrink: 0; }
      .secondary-actions { display: grid; grid-template-columns: 1.2fr .8fr; gap: 8px; margin-top: 21px; padding-top: 18px; border-top: 1px solid #eae6ef; }
      .fit-summary { display: flex; align-items: center; gap: 20px; }
      .fit-summary h3 { font-size: 21px; margin: 7px 0 9px; letter-spacing: -.04em; }
      .fit-summary p { font-size: 12px; line-height: 1.7; color: #8a8295; margin: 0; }
      .mini-label { font-size: 9px; letter-spacing: .11em; color: #9b90ad; font-weight: 700; }
      .fit-ring { display: flex; justify-content: center; align-items: center; width: 116px; height: 116px; border-radius: 50%; background: conic-gradient(#7861c3 var(--fit-progress), #eeebf5 0); flex-shrink: 0; }
      .fit-ring > div { border-radius: 50%; width: 100px; height: 100px; background: white; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .fit-ring strong { font-size: 36px; font-weight: 650; letter-spacing: -.06em; color: #6451ae; line-height: 1.1; }
      .fit-ring span { font-size: 10px; color: #a397b4; margin-top: 4px; }
      .fit-note { color: #a299ad; font-size: 10px; line-height: 1.6; margin: 16px 0 0; }
      .section-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .section-title h3 { margin-bottom: 0; }
      .muted-small { font-size: 11px; color: #9990a3; line-height: 1.7; margin: 0 0 12px; }
      .fit-warning { display: flex; align-items: flex-start; gap: 10px; background: #fffbf4; border: 1px solid #f1e8d9; border-radius: 12px; padding: 15px; margin-top: 22px; color: #a38a5f; font-size: 12px; }
      .fit-warning :global(svg) { flex-shrink: 0; }
      .fit-warning strong { font-size: 12px; }
      .fit-warning p, .fit-warning ul { font-size: 11px; line-height: 1.8; margin: 5px 0 0; padding-left: 0; }
      .fit-warning li { margin-left: 14px; }
      .check-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0edf3; font-size: 11px; line-height: 1.65; color: #8a7f96; }
      .fit-reasons { border-top: 1px solid #ede8f1; padding-top: 17px; margin-top: 23px; color: #93859f; }
      .fit-reasons summary { display: flex; justify-content: space-between; cursor: pointer; font-size: 11px; font-weight: 600; list-style: none; }
      .fit-reasons ul { font-size: 11px; line-height: 1.85; padding-left: 18px; }
      .fit-loading { display: flex; gap: 12px; align-items: center; padding: 35px 0; color: #8c809d; font-size: 12px; }
      .queued-panel { text-align: center; padding-top: 5px; }
      .queued-icon { width: 48px; height: 48px; background: #e8f4e9; color: #558767; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 19px; }
      .detail-shell { color: var(--text, #302e42); }
      .role-heading h2, .skill-pill { overflow-wrap: anywhere; }
      .role-content { min-width: 0; }
      .company-name, .role-meta, .description, .panel-intro, .queued-panel p, .resume-loading, .submission-note, .review-promise, .fit-summary p, .mini-label, .fit-ring span, .fit-note, .muted-small, .check-row, .fit-reasons, .fit-loading { color: var(--muted, #77717f); }
      .detail-tabs { border-color: var(--border, #e8e3ec); }
      .detail-tabs button { color: var(--muted, #77717f); }
      .detail-tabs button.selected, .original-link, .text-button, .application-eyebrow, .fit-ring strong { color: var(--accent, #6956ac); }
      .detail-tabs button.selected { border-color: var(--accent, #6956ac); }
      .detail-tabs button span, .skill-pill { background: var(--accent-soft, #eee8f5); color: var(--accent, #6956ac); }
      .application-panel { background: var(--surface, #fff); border-color: var(--border, #e8e3ec); }
      .secondary-actions, .check-row, .fit-reasons { border-color: var(--border, #e8e3ec); }
      .fit-ring { background: conic-gradient(var(--accent, #7861c3) var(--fit-progress), var(--accent-soft, #eeebf5) 0); }
      .fit-ring > div { background: var(--surface, #fff); }
      .skill-pill.matched, .queued-icon { background: var(--success-soft); color: var(--success); }
      .skill-pill.gap, .setup-note, .fit-warning { background: var(--warning-soft); color: var(--warning); border-color: var(--warning-soft); }
      .detail-tabs { border-color: var(--border); }
      .resume-loading, .fit-loading { color: var(--muted); }
      .fit-note, .review-promise, .submission-note p { font-size: 11px; }
      @media(max-width: 700px) { .detail-columns { grid-template-columns: 1fr; gap: 26px; } .role-heading { align-items: flex-start; gap: 13px; } .role-heading h2 { font-size: 24px; } .application-panel { padding: 21px; } .fit-summary { gap: 16px; } .fit-summary h3 { font-size: 20px; } .detail-tabs { gap: 18px; } }
      @media(prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
    `}</style>
  </Modal>;
}
