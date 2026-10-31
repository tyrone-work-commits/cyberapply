'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { useTheme } from '@/lib/theme';
import { SecurityControls } from './security-controls';
import { MobileInstallPanel } from './pwa-controls';
import { ConnectionStatus } from './connection-status';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Icon, Modal, Spinner } from '@/components/ui';

type Experience = { title: string; company: string; start_date: string | null; end_date: string | null; current: boolean; description: string };
type Education = { institution: string; qualification: string; field: string; start_date: string | null; end_date: string | null };
export type ProfileData = {
  full_name: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  location: string; country: string | null; headline: string; summary: string; skills: string[]; certifications: string[];
  experience: Experience[]; education: Education[]; linkedin_url: string | null; website: string | null;
  portfolio_url: string | null; links: Record<string, string>; work_authorization: Record<string, boolean | null>;
  citizenships: string[]; sponsorship_required: boolean | null; security_clearance: string | null;
  years_experience: number | null; salary_expectation: number | null; available_start_date: string | null;
};
export type ProfileResponse = { data: Partial<ProfileData>; confirmed: boolean; updated_at?: string };
export type PreferencesData = {
  roles: string[]; locations: string[]; countries: string[]; work_modes: string[]; remote_only: boolean;
  employment_types: string[]; levels: string[]; min_salary: number | null; currency: string;
  keywords: string[]; exclude_keywords: string[]; excluded_companies: string[];
};
type PreferencesResponse = { data: Partial<PreferencesData>; updated_at?: string };
export type Resume = {
  id: string; title: string; document_id: string | null; profile_data: Partial<ProfileData>; reviewed: boolean;
  is_main: boolean; version: number; extracted_text?: string; warnings?: string[]; extraction_status?: string; created_at?: string; updated_at?: string;
};
type Page<T> = { items: T[]; total: number; limit?: number; offset?: number };
type Analysis = { word_count: number; sections_detected: Record<string, boolean>; suggestions: { code: string; message: string }[]; limitations: string[] };
type Automation = { mode: 'review' | 'automatic'; paused: boolean; daily_limit: number; min_match_score: number; used_today: number; remaining_today: number; quota_timezone: string };
type Capabilities = { auth_mode: 'local' | 'supabase'; email_delivery: 'capture' | 'smtp' | 'provider' };
type FAQ = { id: string; category: string; question: string; answer: string };
type Problem = { id: string; description: string; status: 'open' | 'closed'; created_at: string };

const profileDefaults: ProfileData = {
  full_name: '', first_name: '', last_name: '', email: null, phone: null, location: '', country: null,
  headline: '', summary: '', skills: [], certifications: [], experience: [], education: [], linkedin_url: null,
  website: null, portfolio_url: null, links: {}, work_authorization: {}, citizenships: [], sponsorship_required: null,
  security_clearance: null, years_experience: null, salary_expectation: null, available_start_date: null,
};
const preferenceDefaults: PreferencesData = {
  roles: [], locations: [], countries: [], work_modes: [], remote_only: false, employment_types: [], levels: [],
  min_salary: null, currency: 'USD', keywords: [], exclude_keywords: [], excluded_companies: [],
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const labels = (value: string) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
const nullable = (value: string) => value.trim() || null;
const nullableNumber = (value: string) => value === '' ? null : Number(value);
const pretty = (value: string) => value.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase());
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Just added';

/** Text is kept as text while typing so commas and trailing spaces remain editable. */
function CommaField({ label, values, onChange, hint, placeholder, countries = false }: {
  label: string; values: string[]; onChange: (values: string[]) => void; hint?: string; placeholder?: string; countries?: boolean;
}) {
  const [text, setText] = useState(values.join(', '));
  const editing = useRef(false);
  const signature = values.join(', ');
  useEffect(() => { if (!editing.current) setText(signature); }, [signature]);
  return <Field label={label} hint={hint || 'Separate entries with commas.'}><input value={text} placeholder={placeholder} onFocus={() => { editing.current = true; }} onChange={event => {
    setText(event.target.value); onChange(labels(event.target.value).map(item => countries ? item.toUpperCase() : item));
  }} onBlur={() => {
    editing.current = false;
    const next = labels(text).map(item => countries ? item.toUpperCase() : item);
    onChange(next); setText(next.join(', '));
  }} /></Field>;
}

function BooleanSelect({ value, onChange }: { value: boolean | null; onChange: (value: boolean | null) => void }) {
  return <select value={value === null ? 'unknown' : value ? 'yes' : 'no'} onChange={event => onChange(event.target.value === 'unknown' ? null : event.target.value === 'yes')}>
    <option value="unknown">Not specified</option><option value="yes">Yes</option><option value="no">No</option>
  </select>;
}

export function ProfileFields({ value, onChange }: { value: ProfileData; onChange: (data: ProfileData) => void }) {
  const update = <K extends keyof ProfileData>(key: K, next: ProfileData[K]) => onChange({ ...value, [key]: next });
  const [authorizationCountry, setAuthorizationCountry] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  return <div className="stack">
    <div className="form-grid">
      <Field label="Full name"><input maxLength={200} autoComplete="name" value={value.full_name} onChange={event => update('full_name', event.target.value)} placeholder="Your full name" /></Field>
      <Field label="Professional headline"><input maxLength={250} value={value.headline} onChange={event => update('headline', event.target.value)} placeholder="e.g. Security analyst" /></Field>
      <Field label="Contact email"><input type="email" autoComplete="email" value={value.email || ''} onChange={event => update('email', nullable(event.target.value))} placeholder="you@example.com" /></Field>
      <Field label="Phone"><input type="tel" maxLength={40} autoComplete="tel" value={value.phone || ''} onChange={event => update('phone', nullable(event.target.value))} placeholder="Include your country code" /></Field>
      <Field label="Location"><input maxLength={200} value={value.location} onChange={event => update('location', event.target.value)} placeholder="City, region" /></Field>
      <Field label="Country code" hint="Two letters, such as NG, GB or US."><input maxLength={2} pattern="[A-Za-z]{2}" value={value.country || ''} onChange={event => update('country', nullable(event.target.value.toUpperCase()))} placeholder="NG" /></Field>
      <CommaField label="Skills" values={value.skills} onChange={next => update('skills', next)} placeholder="SIEM, incident response, Python" />
      <CommaField label="Certifications you hold" values={value.certifications} onChange={next => update('certifications', next)} placeholder="Security+, CISSP" hint="Only include credentials you actually hold. Separate with commas." />
    </div>
    <Field label="Professional summary"><textarea rows={4} maxLength={10000} value={value.summary} onChange={event => update('summary', event.target.value)} placeholder="Describe your experience in your own words." /></Field>
    <details className="details-section">
      <summary>Experience and education <Icon name="chevron-down" size={16} /></summary>
      <div className="stack">
        <div className="section-heading"><h3>Experience</h3><Button variant="secondary" size="sm" disabled={value.experience.length >= 50} onClick={() => update('experience', [...value.experience, { title: '', company: '', start_date: null, end_date: null, current: false, description: '' }])}><Icon name="plus" size={16} /> Add experience</Button></div>
        {value.experience.map((item, index) => <Card key={index} className="stack compact-card">
          <div className="section-heading"><strong>Experience {index + 1}</strong><Button variant="ghost" size="sm" aria-label={`Remove experience ${index + 1}`} onClick={() => update('experience', value.experience.filter((_, position) => position !== index))}><Icon name="trash" size={16} /></Button></div>
          <div className="form-grid">
            <Field label="Job title"><input required maxLength={150} value={item.title} onChange={event => update('experience', value.experience.map((entry, position) => position === index ? { ...entry, title: event.target.value } : entry))} /></Field>
            <Field label="Company"><input required maxLength={150} value={item.company} onChange={event => update('experience', value.experience.map((entry, position) => position === index ? { ...entry, company: event.target.value } : entry))} /></Field>
            <Field label="Start date"><input type="date" value={item.start_date || ''} onChange={event => update('experience', value.experience.map((entry, position) => position === index ? { ...entry, start_date: nullable(event.target.value) } : entry))} /></Field>
            <Field label="End date"><input type="date" min={item.start_date || undefined} disabled={item.current} value={item.end_date || ''} onChange={event => update('experience', value.experience.map((entry, position) => position === index ? { ...entry, end_date: nullable(event.target.value) } : entry))} /></Field>
          </div>
          <label className="check-field"><input type="checkbox" checked={item.current} onChange={event => update('experience', value.experience.map((entry, position) => position === index ? { ...entry, current: event.target.checked, end_date: event.target.checked ? null : entry.end_date } : entry))} /> I currently work here</label>
          <Field label="What you did"><textarea rows={3} maxLength={5000} value={item.description} onChange={event => update('experience', value.experience.map((entry, position) => position === index ? { ...entry, description: event.target.value } : entry))} /></Field>
        </Card>)}
        <div className="section-heading"><h3>Education</h3><Button variant="secondary" size="sm" disabled={value.education.length >= 30} onClick={() => update('education', [...value.education, { institution: '', qualification: '', field: '', start_date: null, end_date: null }])}><Icon name="plus" size={16} /> Add education</Button></div>
        {value.education.map((item, index) => <Card key={index} className="stack compact-card">
          <div className="section-heading"><strong>Education {index + 1}</strong><Button variant="ghost" size="sm" aria-label={`Remove education ${index + 1}`} onClick={() => update('education', value.education.filter((_, position) => position !== index))}><Icon name="trash" size={16} /></Button></div>
          <div className="form-grid">{(['institution', 'qualification', 'field'] as const).map(key => <Field label={pretty(key)} key={key}><input required={key !== 'field'} maxLength={150} value={item[key]} onChange={event => update('education', value.education.map((entry, position) => position === index ? { ...entry, [key]: event.target.value } : entry))} /></Field>)}
            <Field label="Start date"><input type="date" value={item.start_date || ''} onChange={event => update('education', value.education.map((entry, position) => position === index ? { ...entry, start_date: nullable(event.target.value) } : entry))} /></Field>
            <Field label="End date"><input type="date" min={item.start_date || undefined} value={item.end_date || ''} onChange={event => update('education', value.education.map((entry, position) => position === index ? { ...entry, end_date: nullable(event.target.value) } : entry))} /></Field>
          </div>
        </Card>)}
      </div>
    </details>
    <details className="details-section">
      <summary>Application details <Icon name="chevron-down" size={16} /></summary>
      <div className="stack">
        <p className="muted">These facts can affect eligibility. Leave anything you do not know unspecified.</p>
        <div className="form-grid">
          <Field label="First name"><input maxLength={100} value={value.first_name} onChange={event => update('first_name', event.target.value)} /></Field>
          <Field label="Last name"><input maxLength={100} value={value.last_name} onChange={event => update('last_name', event.target.value)} /></Field>
          <Field label="Years of experience"><input type="number" min={0} max={80} step="0.5" value={value.years_experience ?? ''} onChange={event => update('years_experience', nullableNumber(event.target.value))} /></Field>
          <Field label="Salary expectation" hint="Amount only; job preferences include your currency."><input type="number" min={0} max={100000000} value={value.salary_expectation ?? ''} onChange={event => update('salary_expectation', nullableNumber(event.target.value))} /></Field>
          <Field label="Available from"><input type="date" value={value.available_start_date || ''} onChange={event => update('available_start_date', nullable(event.target.value))} /></Field>
          <Field label="Will you need sponsorship?"><BooleanSelect value={value.sponsorship_required} onChange={next => update('sponsorship_required', next)} /></Field>
          <Field label="Security clearance"><select value={value.security_clearance || ''} onChange={event => update('security_clearance', nullable(event.target.value))}><option value="">Not specified</option>{['none', 'public_trust', 'confidential', 'secret', 'top_secret', 'ts_sci'].map(item => <option key={item} value={item}>{item === 'ts_sci' ? 'TS / SCI' : pretty(item)}</option>)}</select></Field>
          <CommaField label="Citizenships" countries values={value.citizenships} onChange={next => update('citizenships', next)} hint="Two-letter country codes, separated by commas." placeholder="NG, GB" />
        </div>
        <h3>Work authorization by country</h3>
        {Object.entries(value.work_authorization).map(([country, authorized]) => <div className="row" key={country}><Field label={country}><BooleanSelect value={authorized} onChange={next => update('work_authorization', { ...value.work_authorization, [country]: next })} /></Field><Button variant="ghost" aria-label={`Remove ${country} work authorization`} onClick={() => { const next = { ...value.work_authorization }; delete next[country]; update('work_authorization', next); }}><Icon name="trash" size={18} /></Button></div>)}
        <div className="row"><Field label="Country code"><input maxLength={2} value={authorizationCountry} onChange={event => setAuthorizationCountry(event.target.value.toUpperCase())} placeholder="US" /></Field><Button variant="secondary" disabled={!/^[A-Z]{2}$/.test(authorizationCountry) || Object.keys(value.work_authorization).length >= 30} onClick={() => { update('work_authorization', { ...value.work_authorization, [authorizationCountry]: value.work_authorization[authorizationCountry] ?? null }); setAuthorizationCountry(''); }}>Add country</Button></div>
      </div>
    </details>
    <details className="details-section">
      <summary>Professional links <Icon name="chevron-down" size={16} /></summary>
      <div className="stack">
        <div className="form-grid">{([['linkedin_url', 'LinkedIn'], ['website', 'Website'], ['portfolio_url', 'Portfolio']] as const).map(([key, label]) => <Field label={label} key={key}><input type="url" maxLength={2048} pattern="https://.*" value={value[key] || ''} onChange={event => update(key, nullable(event.target.value))} placeholder="https://" /></Field>)}</div>
        {Object.entries(value.links).map(([name, url]) => <div className="row" key={name}><Field label={name}><input type="url" maxLength={2048} pattern="https://.*" value={url} onChange={event => update('links', { ...value.links, [name]: event.target.value })} /></Field><Button variant="ghost" aria-label={`Remove ${name} link`} onClick={() => { const next = { ...value.links }; delete next[name]; update('links', next); }}><Icon name="trash" size={18} /></Button></div>)}
        <div className="form-grid"><Field label="Link name"><input maxLength={80} value={linkName} onChange={event => setLinkName(event.target.value)} placeholder="GitHub" /></Field><Field label="Link URL"><input type="url" maxLength={2048} value={linkUrl} onChange={event => setLinkUrl(event.target.value)} placeholder="https://" /></Field></div>
        <Button variant="secondary" disabled={!linkName.trim() || !linkUrl.startsWith('https://') || Object.keys(value.links).length >= 20} onClick={() => { update('links', { ...value.links, [linkName.trim()]: linkUrl.trim() }); setLinkName(''); setLinkUrl(''); }}>Add link</Button>
      </div>
    </details>
  </div>;
}

export function ProfileEditor({ onSaved, requireConfirmation = false }: { onSaved?: () => void; requireConfirmation?: boolean }) {
  const { request, notify, refresh } = useWorkspace();
  const load = useLoad<ProfileResponse>('/profiles/me');
  const [data, setData] = useState<ProfileData>(profileDefaults);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (load.data) { setData({ ...profileDefaults, ...load.data.data }); setConfirmed(load.data.confirmed); } }, [load.data]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await request('/profiles/me', { method: 'PUT', body: { data, confirmed } }); notify(confirmed ? 'Profile confirmed and saved.' : 'Profile saved. Confirm your facts before applying.', 'success'); refresh(); load.reload(); onSaved?.(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  if (load.loading && !load.data) return <Spinner />;
  if (load.error && !load.data) return <div className="stack"><ErrorNotice error={load.error} /><Button variant="secondary" onClick={load.reload}>Try again</Button></div>;
  return <form className="stack" onSubmit={save}>
    <ProfileFields value={data} onChange={next => { setData(next); setConfirmed(false); }} />
    <label className="check-field"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I have reviewed these facts and confirm they are accurate.</label>
    <ErrorNotice error={error} />
    <div className="row"><Button type="submit" loading={busy} disabled={requireConfirmation && !confirmed}>{requireConfirmation ? 'Save and continue' : 'Save profile'} <Icon name={requireConfirmation ? 'arrow-right' : 'check'} size={17} /></Button><span className="muted">You control what goes into every application.</span></div>
  </form>;
}

function MultiChoice({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="choice-field"><legend className="field-label">{label}</legend><div className="row wrap">{options.map(option => <label className={`choice-chip ${value.includes(option) ? 'selected' : ''}`} key={option}><input type="checkbox" checked={value.includes(option)} onChange={event => onChange(event.target.checked ? [...value, option] : value.filter(item => item !== option))} /><span>{pretty(option)}</span></label>)}</div></fieldset>;
}

export function PreferencesEditor({ onSaved }: { onSaved?: () => void }) {
  const { request, notify, refresh } = useWorkspace();
  const load = useLoad<PreferencesResponse>('/preferences/me');
  const [data, setData] = useState<PreferencesData>(preferenceDefaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (load.data) setData({ ...preferenceDefaults, ...load.data.data }); }, [load.data]);
  const update = <K extends keyof PreferencesData>(key: K, next: PreferencesData[K]) => setData(current => ({ ...current, [key]: next }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await request('/preferences/me', { method: 'PUT', body: data }); notify('Job preferences saved.', 'success'); refresh(); load.reload(); onSaved?.(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  if (load.loading && !load.data) return <Spinner />;
  if (load.error && !load.data) return <div className="stack"><ErrorNotice error={load.error} /><Button variant="secondary" onClick={load.reload}>Try again</Button></div>;
  return <form className="stack" onSubmit={save}>
    <div className="form-grid"><CommaField label="Roles you want" values={data.roles} onChange={next => update('roles', next)} placeholder="SOC Analyst, Security Engineer" hint="Choose the roles you want to pursue. Separate with commas." /><CommaField label="Preferred locations" values={data.locations} onChange={next => update('locations', next)} placeholder="Lagos, London" /><CommaField label="Preferred countries" countries values={data.countries} onChange={next => update('countries', next)} hint="Two-letter country codes, separated by commas." placeholder="NG, GB" /></div>
    <MultiChoice label="Work arrangement" options={['remote', 'hybrid', 'onsite']} value={data.work_modes} onChange={next => setData(current => ({ ...current, work_modes: next, remote_only: current.remote_only && next.every(item => item === 'remote') }))} />
    <label className="check-field"><input type="checkbox" checked={data.remote_only} onChange={event => setData(current => ({ ...current, remote_only: event.target.checked, work_modes: event.target.checked ? ['remote'] : current.work_modes }))} /> Only consider remote roles</label>
    <MultiChoice label="Employment type" options={['full_time', 'part_time', 'contract', 'internship', 'temporary', 'unspecified']} value={data.employment_types} onChange={next => update('employment_types', next)} />
    <MultiChoice label="Seniority" options={['intern', 'entry', 'mid', 'senior', 'lead', 'manager', 'director', 'executive', 'unspecified']} value={data.levels} onChange={next => update('levels', next)} />
    <div className="form-grid"><Field label="Minimum annual salary"><input type="number" min={0} max={100000000} value={data.min_salary ?? ''} onChange={event => update('min_salary', nullableNumber(event.target.value))} placeholder="No minimum" /></Field><Field label="Currency code"><input required pattern="[A-Z]{3}" maxLength={3} value={data.currency} onChange={event => update('currency', event.target.value.toUpperCase())} placeholder="USD" /></Field></div>
    <details className="details-section"><summary>Fine-tune your search <Icon name="chevron-down" size={16} /></summary><div className="form-grid"><CommaField label="Include keywords" values={data.keywords} onChange={next => update('keywords', next)} placeholder="cloud security, threat detection" /><CommaField label="Exclude keywords" values={data.exclude_keywords} onChange={next => update('exclude_keywords', next)} /><CommaField label="Exclude companies" values={data.excluded_companies} onChange={next => update('excluded_companies', next)} /></div></details>
    <ErrorNotice error={error} /><Button type="submit" loading={busy}>{onSaved ? 'Save and continue' : 'Save preferences'}<Icon name={onSaved ? 'arrow-right' : 'check'} size={17} /></Button>
  </form>;
}

export function ResumeManager({ onReviewed }: { onReviewed?: () => void }) {
  const { request, notify, refresh } = useWorkspace();
  const load = useLoad<Page<Resume>>('/resumes?limit=50');
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadWarnings = useRef<Record<string, { version: number; messages: string[] }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Resume | null>(null);
  const [facts, setFacts] = useState<ProfileData>(profileDefaults);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [applyToProfile, setApplyToProfile] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [resumeTab, setResumeTab] = useState<'facts' | 'text'>('facts');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisTitle, setAnalysisTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Resume | null>(null);
  const changed = () => { load.reload(); refresh(); };
  const openResume = (resume: Resume) => {
    const extraction = uploadWarnings.current[resume.id];
    const warnings = [...new Set([...(resume.warnings || []), ...(extraction?.version === resume.version ? extraction.messages : [])])];
    setSelected({ ...resume, warnings }); setFacts({ ...profileDefaults, ...resume.profile_data }); setEditTitle(resume.title);
    setEditText(resume.extracted_text || ''); setReviewConfirmed(false); setApplyToProfile(false); setResumeTab('facts'); setError(null);
  };
  useEffect(() => {
    const url = new URL(location.href); const id = url.searchParams.get('resume');
    if (!id) return; let active = true;
    request<Resume>(`/resumes/${id}`).then(resume => { if (active) { openResume(resume); url.searchParams.delete('resume'); history.replaceState(null, '', url); } }).catch(failure => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; };
    // This opens only the draft requested when entering the résumé lab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return; setBusy(key); setError(null);
    try { await action(); } catch (failure) { setError(errorMessage(failure)); notify(errorMessage(failure), 'error'); }
    finally { setBusy(null); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('Please choose a file smaller than 10 MB.'); return; }
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) { setError('Choose a PDF, DOCX or TXT résumé.'); return; }
    await run('upload', async () => {
      const form = new FormData(); form.append('file', file);
      const result = await request<{ resume: Resume; extraction?: { status?: string; needs_manual_edit?: boolean; message?: string; warnings?: string[] } }>('/resumes/upload', { method: 'POST', body: form });
      const extraction = result.extraction;
      const manual = extraction?.needs_manual_edit || extraction?.status === 'manual_review_required' || !result.resume.extracted_text?.trim();
      uploadWarnings.current[result.resume.id] = { version: result.resume.version, messages: [...(extraction?.warnings || []), ...(extraction?.message ? [extraction.message] : []), ...(manual ? ['Readable résumé text is not available. Paste the text or enter and review your candidate facts manually.'] : [])] };
      changed(); openResume({ ...result.resume, extraction_status: extraction?.status || (manual ? 'manual_review_required' : 'extracted') });
      if (manual) setResumeTab('text');
      notify(manual ? 'Résumé uploaded. Manual text or candidate fact review is needed.' : 'Résumé uploaded. Review the extracted facts next.', 'success');
    });
    if (fileInput.current) fileInput.current.value = '';
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); await run('create', async () => {
      const result = await request<Resume>('/resumes', { method: 'POST', body: { title: title.trim(), text } });
      changed(); setCreateOpen(false); setTitle(''); setText(''); openResume(result);
    });
  };
  const review = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected || !reviewConfirmed) return;
    await run('review', async () => {
      const result = await request<{ resume: Resume }>(`/resumes/${selected.id}/review`, { method: 'POST', body: { version: selected.version, profile_data: facts, apply_to_profile: applyToProfile } });
      setSelected(result.resume); changed(); notify('Résumé facts confirmed.', 'success'); setSelected(null); onReviewed?.();
    });
  };
  const saveText = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected) return;
    await run('edit', async () => {
      const body: { version: number; title?: string; text?: string } = { version: selected.version };
      if (editTitle !== selected.title) body.title = editTitle;
      if (editText !== (selected.extracted_text || '')) body.text = editText;
      const result = await request<Resume>(`/resumes/${selected.id}`, { method: 'PUT', body });
      changed(); openResume(result); notify('Changes saved. Review the résumé facts again.', 'success');
    });
  };
  const download = (resume: Resume) => run(resume.id, async () => {
    const blob = await request<Blob>(`/resumes/${resume.id}/download`, { responseType: 'blob' });
    const extension = blob.type.includes('pdf') ? 'pdf' : blob.type.includes('wordprocessingml') ? 'docx' : 'txt';
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${resume.title.replace(/\.(pdf|docx|txt)$/i, '').replace(/[\\/:*?"<>|]/g, '_')}.${extension}`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <div className="stack">
    <input ref={fileInput} type="file" accept=".pdf,.docx,.txt" className="sr-only" aria-label="Upload résumé" onChange={event => void upload(event.target.files?.[0])} />
    <div className="upload-zone"><div className="empty-icon"><Icon name="upload" size={25} /></div><h3>Your experience, in your words.</h3><p className="muted">Upload a résumé, then review the facts before it is used.</p><div className="row wrap"><Button loading={busy === 'upload'} disabled={!!busy} onClick={() => fileInput.current?.click()}><Icon name="upload" size={17} /> Upload résumé</Button><Button variant="secondary" disabled={!!busy} onClick={() => { setCreateOpen(true); setError(null); }}><Icon name="file" size={17} /> Create from text</Button></div><small className="muted">PDF, DOCX or TXT · Up to 10 MB</small></div>
    <ErrorNotice error={error} />
    {load.loading && !load.data ? <Spinner /> : load.error && !load.data ? <div className="stack"><ErrorNotice error={load.error} /><Button variant="secondary" onClick={load.reload}>Try again</Button></div> : load.data?.items.length ? <div className="stack">{load.data.items.map(resume => <Card className="resume-card stack" key={resume.id}>
      <div className="row wrap full-width"><div className="resume-icon"><Icon name="file-text" size={24} /></div><div className="grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}><h3>{resume.title}</h3><p className="muted">Version {resume.version} · {dateLabel(resume.updated_at || resume.created_at)}</p></div><div className="row wrap">{resume.is_main && <Badge tone="info">Main résumé</Badge>}<Badge tone={resume.reviewed ? 'success' : 'warning'}>{resume.reviewed ? 'Facts reviewed' : 'Review needed'}</Badge></div></div>
      <div className="resume-actions row wrap"><Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void run(resume.id, async () => openResume(await request<Resume>(`/resumes/${resume.id}`)))}><Icon name="eye" size={16} /> Review / edit</Button>{!resume.is_main && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void run(resume.id, async () => { await request(`/resumes/${resume.id}/select`, { method: 'POST' }); changed(); notify('Main résumé updated for future applications.', 'success'); })}>Use as main</Button>}<Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void run(resume.id, async () => { setAnalysis(await request<Analysis>(`/resumes/${resume.id}/analysis`)); setAnalysisTitle(resume.title); })}><Icon name="sparkles" size={16} /> Analysis</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void download(resume)} aria-label={`Download ${resume.title}`}><Icon name="download" size={17} /> Download</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setDeleteTarget(resume)} aria-label={`Delete ${resume.title}`}><Icon name="trash" size={17} /></Button></div>
    </Card>)}</div> : <EmptyState icon="file" title="No résumés yet" description="Add the résumé you would like to use for your next opportunity." />}
    <Modal open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }} title="Create a résumé" wide><form className="stack" onSubmit={create}><Field label="Résumé title"><input required maxLength={255} value={title} onChange={event => setTitle(event.target.value)} placeholder="My cybersecurity résumé" /></Field><Field label="Résumé text" hint="Paste the complete résumé. You will review any suggested facts next."><textarea required rows={14} maxLength={200000} value={text} onChange={event => setText(event.target.value)} placeholder="Professional summary\n\nExperience\n\nSkills\n\nEducation" /></Field><ErrorNotice error={error} /><Button type="submit" loading={busy === 'create'} disabled={!text.trim() || !title.trim()}>Create and review <Icon name="arrow-right" size={17} /></Button></form></Modal>
    <Modal open={!!selected} onClose={() => { if (!busy) setSelected(null); }} title={selected?.title || 'Review résumé'} wide>{selected && <div className="stack">
      <div className="row wrap"><Badge tone={selected.reviewed ? 'success' : 'warning'}>{selected.reviewed ? 'Reviewed' : 'Review required'}</Badge>{!selected.extracted_text?.trim() && <Badge tone="warning">{selected.reviewed ? 'Résumé text unavailable' : 'Manual text / fact entry needed'}</Badge>}<span className="muted">Version {selected.version}</span></div>
      {!!selected.warnings?.length && <div className="inline-notice stack">{selected.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <div className="section-tabs" role="group" aria-label="Résumé review"><button type="button" aria-pressed={resumeTab === 'facts'} className={resumeTab === 'facts' ? 'active' : ''} onClick={() => setResumeTab('facts')}>Candidate facts</button><button type="button" aria-pressed={resumeTab === 'text'} className={resumeTab === 'text' ? 'active' : ''} onClick={() => setResumeTab('text')}>Résumé text</button></div>
      {resumeTab === 'facts' ? <form className="stack" onSubmit={review}><p className="muted">Check every fact below against your résumé. Extraction can miss details or mistake a mention for a credential.</p><ProfileFields value={facts} onChange={next => { setFacts(next); setReviewConfirmed(false); }} /><label className="check-field"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} /> I have reviewed these facts and confirm they are accurate.</label><label className="check-field"><input type="checkbox" checked={applyToProfile} onChange={event => setApplyToProfile(event.target.checked)} /> Also replace my candidate profile with these reviewed facts</label><ErrorNotice error={error} /><Button type="submit" loading={busy === 'review'} disabled={!reviewConfirmed}>Confirm résumé facts <Icon name="check-circle" size={17} /></Button></form> : <form className="stack" onSubmit={saveText}><Field label="Title"><input required maxLength={255} value={editTitle} onChange={event => setEditTitle(event.target.value)} /></Field><Field label="Résumé text"><textarea rows={18} maxLength={200000} value={editText} onChange={event => setEditText(event.target.value)} /></Field>{selected.document_id && <p className="inline-notice">Editing the text creates a text résumé for future downloads and applications. Upload a revised PDF or DOCX to keep that file format.</p>}<ErrorNotice error={error} /><Button type="submit" loading={busy === 'edit'} disabled={editTitle === selected.title && editText === (selected.extracted_text || '')}>Save changes</Button></form>}
    </div>}</Modal>
    <Modal open={!!analysis} onClose={() => setAnalysis(null)} title={`Résumé analysis · ${analysisTitle}`}><div className="stack">{analysis && <><div className="row"><Icon name="file-text" /><strong>{analysis.word_count.toLocaleString()} words</strong><Badge tone="neutral">Content checks</Badge></div><div className="row wrap">{Object.entries(analysis.sections_detected).map(([section, found]) => <Badge key={section} tone={found ? 'success' : 'neutral'}>{found ? '✓ ' : ''}{pretty(section)}</Badge>)}</div>{analysis.suggestions.length ? <div className="stack">{analysis.suggestions.map((suggestion, index) => <p className="inline-notice" key={`${suggestion.code}-${index}`}>{suggestion.message}</p>)}</div> : <p>These content checks found no suggestions.</p>}<p className="muted">These checks offer guidance, without predicting ATS results or hiring outcomes.</p>{analysis.limitations.map(item => <small className="muted" key={item}>{item}</small>)}</>}</div></Modal>
    <Modal open={!!deleteTarget} onClose={() => { if (!busy) setDeleteTarget(null); }} title="Delete résumé"><div className="stack"><p>Delete <strong>{deleteTarget?.title}</strong>? Résumés already used by an application are retained for your records.</p><ErrorNotice error={error} /><div className="row"><Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={!!busy}>Keep résumé</Button><Button variant="danger" loading={busy === 'delete'} onClick={() => { if (!deleteTarget) return; void run('delete', async () => { await request(`/resumes/${deleteTarget.id}`, { method: 'DELETE' }); changed(); setDeleteTarget(null); notify('Résumé deleted.', 'success'); }); }}>Delete résumé</Button></div></div></Modal>
  </div>;
}

function AutomationPanel() {
  const { request, notify, refresh, navigate, demo } = useWorkspace();
  const load = useLoad<Automation>('/automation');
  const profile = useLoad<ProfileResponse>('/profiles/me');
  const resumes = useLoad<Page<Resume>>('/resumes?limit=50');
  const preferences = useLoad<PreferencesResponse>('/preferences/me');
  const [mode, setMode] = useState<'review' | 'automatic'>('review');
  const [dailyLimit, setDailyLimit] = useState(10);
  const [score, setScore] = useState(70);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (load.data) { setMode(load.data.mode); setDailyLimit(load.data.daily_limit); setScore(load.data.min_match_score); setPaused(load.data.paused); } }, [load.data]);
  const mainResume = resumes.data?.items.find(item => item.is_main);
  const ready = !!profile.data?.confirmed && !!mainResume?.reviewed && !!preferences.data?.data.roles?.length;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await request('/automation', { method: 'PATCH', body: { mode, paused, daily_limit: dailyLimit, min_match_score: score } }); load.reload(); refresh(); notify('Application settings saved.', 'success'); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  if (load.loading && !load.data) return <Spinner />;
  if (load.error && !load.data) return <div className="stack"><ErrorNotice error={load.error} /><Button variant="secondary" onClick={load.reload}>Try again</Button></div>;
  return <form className="stack" onSubmit={save}>
    <div className="row wrap"><Badge tone={paused ? 'warning' : 'success'}>{paused ? 'Paused' : 'Active'}</Badge>{load.data && <span className="muted">{load.data.used_today} / {load.data.daily_limit} queued today · resets at midnight UTC</span>}</div>
    <div className="choice-grid">{(['review', 'automatic'] as const).map(option => <label key={option} className={`choice-card stack ${mode === option ? 'selected' : ''}`} style={{ alignItems: 'flex-start' }}><span className="row"><input type="radio" name="application-mode" checked={mode === option} onChange={() => setMode(option)} /><Icon name={option === 'review' ? 'eye' : 'sparkles'} size={23} /></span><strong>{option === 'review' ? 'Review first' : 'Automatic'}</strong><span className="muted">{option === 'review' ? 'Approve each application before it joins the queue.' : 'Queue eligible matches within your preferences and limits.'}</span></label>)}</div>
    {!ready && <div className="inline-notice stack"><strong>Complete your application setup</strong><div className="row wrap">{!profile.data?.confirmed && <Button variant="ghost" size="sm" onClick={() => navigate('profile')}>Confirm profile <Icon name="arrow-right" size={15} /></Button>}{!mainResume?.reviewed && <Button variant="ghost" size="sm" onClick={() => navigate('profile:resume')}>Review main résumé <Icon name="arrow-right" size={15} /></Button>}{!preferences.data?.data.roles?.length && <Button variant="ghost" size="sm" onClick={() => navigate('profile:preferences')}>Choose job roles <Icon name="arrow-right" size={15} /></Button>}</div></div>}
    <div className="form-grid"><Field label="Daily application limit" hint="Between 1 and 100 applications per UTC day."><input type="number" required min={1} max={100} value={dailyLimit} onChange={event => setDailyLimit(Number(event.target.value))} /></Field><Field label={`Minimum match score · ${score}%`} hint="Matches must also satisfy eligibility checks."><input type="range" min={0} max={100} value={score} onChange={event => setScore(Number(event.target.value))} /><input type="number" required min={0} max={100} value={score} aria-label="Minimum match score" onChange={event => setScore(Number(event.target.value))} /></Field></div>
    <label className="check-field"><input type="checkbox" checked={paused} onChange={event => setPaused(event.target.checked)} /> Pause new application processing</label>
    <p className="muted">Jobs with missing facts, extra questions or unsupported application forms may need your attention. An application already in progress may finish after you pause.</p>
    {demo && <p className="inline-notice">Demo applications are simulated. Employers will not receive them.</p>}
    <ErrorNotice error={error} /><Button type="submit" loading={busy}>Save application settings</Button>
  </form>;
}

function AppearancePanel() {
  const { theme, themes, preference, setPreference, textSize, setTextSize, syncStatus } = useTheme();
  return <div className="stack"><p className="muted">Make your workspace feel like you. Your theme and text size follow your account across devices.</p><div className="theme-grid">{themes.map(item => <button type="button" key={item.id} className={`theme-option ${preference === item.id ? 'selected' : ''}`} onClick={() => setPreference(item.id)} aria-pressed={preference === item.id}><div className="theme-swatches">{item.colors.map((color, index) => <span key={index} style={{ backgroundColor: color }} />)}</div><div className="section-heading"><strong>{item.name}</strong>{preference === item.id && <Icon name="check-circle" size={19} />}</div><span className="muted">{item.description}</span></button>)}</div><label className="check-field"><input type="checkbox" checked={preference === 'system'} onChange={event => setPreference(event.target.checked ? 'system' : theme)} /><Icon name="laptop" size={18} /> Follow my device appearance</label><p className="muted">System appearance uses Paper in light mode and Midnight in dark mode.</p><Field label="Text size"><select value={textSize} onChange={event=>setTextSize(event.target.value as "normal"|"large")}><option value="normal">Standard</option><option value="large">Larger text</option></select></Field><p className="muted" role="status">{syncStatus}</p><MobileInstallPanel/></div>;
}

function AccountPanel() {
  const workspace = useWorkspace();
  const { user, request, notify, demo, refresh } = workspace;
  const capabilities = useLoad<Capabilities>('/auth/capabilities');
  const currentUser = useLoad<{ email: string | null; phone: string | null; email_verified: boolean }>('/auth/me');
  const account = currentUser.data || user;
  const [token, setToken] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const mfaStatus = useLoad<{enabled:boolean}>(demo?null:'/auth/mfa/status');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const local = capabilities.data?.auth_mode === 'local';
  const action = async (key: string, callback: () => Promise<void>) => { if (busy) return; setBusy(key); setError(null); setNotice(''); try { await callback(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(null); } };
  const deliveryNotice = capabilities.data?.email_delivery === 'capture' ? 'This local workspace captures verification and reset instructions in the backend auth outbox. No email is delivered.' : 'Check your email for the next step.';
  const endPasswordSession = () => { if (!demo && local && 'logout' in workspace && typeof workspace.logout === 'function') void workspace.logout(); };
  return <div className="stack">
    <Card className="stack compact-card"><div className="section-heading"><div><h3>Sign-in details</h3><p className="muted">Your account identity is separate from your résumé contact information.</p></div><Icon name="shield-check" size={24} /></div><div className="row wrap"><Icon name="mail" size={18} /><span>{account?.email || 'No email on this account'}</span><Badge tone={account?.email_verified ? 'success' : 'warning'}>{account?.email_verified ? 'Verified' : 'Unverified'}</Badge></div>{account?.phone && <div className="row"><Icon name="phone" size={18} />{account.phone}</div>}
      {!account?.email_verified && account?.email && <Button variant="secondary" loading={busy === 'verification'} disabled={!!busy} onClick={() => void action('verification', async () => { await request('/auth/email/request-verification', { method: 'POST' }); setNotice(demo ? 'Verification is simulated in this demo.' : deliveryNotice); })}>Request verification instructions</Button>}
      {local && !account?.email_verified && <form className="stack" onSubmit={event => { event.preventDefault(); void action('verify-token', async () => { await request('/auth/email/verify', { method: 'POST', body: { token } }); setToken(''); currentUser.reload(); refresh(); notify('Email verified.', 'success'); }); }}><Field label="Verification token"><input required minLength={20} maxLength={4096} value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></Field><Button variant="secondary" type="submit" loading={busy === 'verify-token'} disabled={!!busy}>Verify email</Button></form>}
    </Card>
    <details className="details-section"><summary>Change password <Icon name="lock" size={17} /></summary><form className="stack" onSubmit={event => { event.preventDefault(); if (password !== confirmPassword) { setError('The new passwords do not match.'); return; } void action('password', async () => { await request('/auth/password', { method: 'PUT', body: { password, ...(local ? { current_password: currentPassword, mfa_code:mfaCode||undefined } : {}) } }); setCurrentPassword(''); setPassword(''); setConfirmPassword(''); notify(demo ? 'Password change simulated.' : local ? 'Password changed. Sign in again with your new password.' : 'Password changed.', 'success'); endPasswordSession(); }); }}>
      {local && <Field label="Current password"><input type="password" required maxLength={128} autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></Field>}
      {local && mfaStatus.data?.enabled && <Field label="New authenticator or unused recovery code"><input required value={mfaCode} maxLength={64} autoComplete="one-time-code" onChange={event=>setMfaCode(event.target.value)}/></Field>}<Field label="New password" hint="Use at least 12 characters."><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></Field><Field label="Confirm new password"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></Field><Button type="submit" loading={busy === 'password'} disabled={!!busy || !capabilities.data}>Change password</Button>
    </form></details>
    {account?.email && <details className="details-section"><summary>Password recovery <Icon name="mail" size={17} /></summary><div className="stack"><p className="muted">Request recovery instructions for {account.email}.</p><Button variant="secondary" loading={busy === 'reset-request'} disabled={!!busy} onClick={() => void action('reset-request', async () => { await request('/auth/password/request-reset', { method: 'POST', body: { email: account.email } }); setNotice(demo ? 'Password recovery is simulated in this demo.' : deliveryNotice); })}>Request password reset</Button>{local && <form className="stack" onSubmit={event => { event.preventDefault(); if (resetPassword !== resetConfirm) { setError('The new passwords do not match.'); return; } void action('reset', async () => { await request('/auth/password/reset', { method: 'POST', body: { token: resetToken, password: resetPassword, mfa_code:mfaCode||undefined } }); setResetToken(''); setResetPassword(''); setResetConfirm(''); notify(demo ? 'Password reset simulated.' : 'Password reset. Sign in again with your new password.', 'success'); endPasswordSession(); }); }}><Field label="Reset token"><input required minLength={20} maxLength={4096} autoComplete="off" value={resetToken} onChange={event => setResetToken(event.target.value)} /></Field>{local && mfaStatus.data?.enabled && <Field label="New authenticator or unused recovery code"><input required value={mfaCode} maxLength={64} autoComplete="one-time-code" onChange={event=>setMfaCode(event.target.value)}/></Field>}<Field label="New password" hint="Use at least 12 characters."><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} /></Field><Field label="Confirm new password"><input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={resetConfirm} onChange={event => setResetConfirm(event.target.value)} /></Field><Button type="submit" loading={busy === 'reset'} disabled={!!busy}>Reset password</Button></form>}{!local && capabilities.data && <p className="muted">Follow the recovery link from your account provider to update your password.</p>}</div></details>}
    {notice && <p className="inline-notice" role="status">{notice}</p>}<ErrorNotice error={error || capabilities.error || currentUser.error} />
  </div>;
}

function SupportPanel() {
  const { request, notify } = useWorkspace();
  const faq = useLoad<{ items: FAQ[]; categories: string[] }>('/support/faq');
  const [offset, setOffset] = useState(0);
  const reports = useLoad<Page<Problem>>(`/support/problems?limit=20&offset=${offset}`);
  const [search, setSearch] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtered = faq.data?.items.filter(item => `${item.question} ${item.answer} ${item.category}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <div className="stack"><Field label="Search help"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Résumés, applications, account…" /></Field><ErrorNotice error={faq.error} />{faq.loading && !faq.data ? <Spinner /> : filtered.length ? <div className="stack">{filtered.map(item => <details className="details-section" key={item.id}><summary>{item.question}<Icon name="chevron-down" size={16} /></summary><p>{item.answer}</p><Badge tone="neutral">{pretty(item.category || 'general')}</Badge></details>)}</div> : <EmptyState icon="help" title="No matching answers" description="Try another term, or describe your problem below." />}
    <Card className="stack"><div><h3>Report a problem</h3><p className="muted">Save a private report in your workspace. Live support messaging is not connected.</p></div><form className="stack" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(null); try { await request('/support/problems', { method: 'POST', body: { description, context: { page: 'profile/help' } } }); setDescription(''); setOffset(0); reports.reload(); notify('Problem report saved.', 'success'); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}><Field label="What happened?" hint="Include what you expected and the steps that led to the problem. Do not include passwords."><textarea required minLength={10} maxLength={5000} rows={4} value={description} onChange={event => setDescription(event.target.value)} /></Field><ErrorNotice error={error} /><Button type="submit" loading={busy}>Save report <Icon name="arrow-right" size={17} /></Button></form></Card>
    <div className="section-heading"><h3>Your reports</h3><Badge>{reports.data?.total ?? 0}</Badge></div><ErrorNotice error={reports.error} />{reports.loading && !reports.data ? <Spinner /> : reports.data?.items.length ? reports.data.items.map(report => <Card className="stack compact-card" key={report.id}><div className="section-heading"><Badge tone={report.status === 'open' ? 'warning' : 'success'}>{pretty(report.status)}</Badge><span className="muted">{dateLabel(report.created_at)}</span></div><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.description}</p><Button variant="ghost" size="sm" loading={changing === report.id} disabled={!!changing} onClick={async () => { setChanging(report.id); setError(null); try { await request(`/support/problems/${report.id}`, { method: 'PATCH', body: { status: report.status === 'open' ? 'closed' : 'open' } }); reports.reload(); } catch (failure) { setError(errorMessage(failure)); } finally { setChanging(null); } }}>{report.status === 'open' ? 'Mark resolved' : 'Reopen report'}</Button></Card>) : <p className="muted">No problem reports yet.</p>}
    {!!reports.data && reports.data.total > 20 && <div className="section-heading"><Button variant="secondary" size="sm" disabled={!offset || reports.loading} onClick={() => setOffset(current => Math.max(0, current - 20))}><Icon name="chevron-left" size={16} /> Previous</Button><span className="muted">{offset + 1}–{Math.min(offset + 20, reports.data.total)} of {reports.data.total}</span><Button variant="secondary" size="sm" disabled={offset + 20 >= reports.data.total || reports.loading} onClick={() => setOffset(current => current + 20)}>Next <Icon name="chevron-right" size={16} /></Button></div>}
  </div>;
}

const sections = [
  { id: 'profile', label: 'My profile', icon: 'user', title: 'The person behind the résumé', description: 'Keep your candidate facts accurate and up to date.' },
  { id: 'resume', label: 'My résumés', icon: 'file-text', title: 'Make your experience count', description: 'Manage, review and refine the résumés you apply with.' },
  { id: 'preferences', label: 'Job preferences', icon: 'sliders', title: 'Your next role, your way', description: 'Tell us what a good opportunity looks like to you.' },
  { id: 'automation', label: 'Application settings', icon: 'sparkles', title: 'You set the pace', description: 'Choose how applications are reviewed and queued.' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', title: 'A workspace that feels like you', description: 'Choose your colors and appearance.' },
  { id: 'account', label: 'Account & security', icon: 'shield', title: 'Your account, protected', description: 'Manage verification and password security.' },
  { id: 'help', label: 'Help & support', icon: 'help', title: 'A little help along the way', description: 'Find answers and keep track of any problems.' },
];

export function ProfileView({ section = 'profile' }: { section?: string }) {
  const { user, navigate } = useWorkspace();
  const profile = useLoad<ProfileResponse>('/profiles/me');
  const resumes = useLoad<Page<Resume>>('/resumes?limit=50');
  const preferences = useLoad<PreferencesResponse>('/preferences/me');
  const normalized = section === 'resumes' ? 'resume' : section === 'support' ? 'help' : section;
  const current = sections.find(item => item.id === normalized) || sections[0];
  const name = profile.data?.data.full_name || user?.email?.split('@')[0] || 'Your profile';
  const completed = Number(!!profile.data?.confirmed) + Number(!!resumes.data?.items.some(item => item.is_main && item.reviewed)) + Number(!!preferences.data?.data.roles?.length);
  return <div className="stack profile-page">
    <div className="page-header"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Profile & preferences</h1><p className="muted">A stronger profile. A more focused search.</p></div><div className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div></div>
    <div className="profile-layout"><aside className="profile-sidebar"><Card className="stack"><div><h3>{name}</h3><p className="muted">{profile.data?.data.headline || 'Your next chapter starts here'}</p></div><div className="section-heading"><span className="muted">Application setup</span><strong>{completed} / 3</strong></div><div className="setup-progress" role="progressbar" aria-label="Application setup" aria-valuemin={0} aria-valuemax={3} aria-valuenow={completed}><span style={{ width: `${completed / 3 * 100}%` }} /></div><nav className="profile-nav" aria-label="Profile sections">{sections.map(item => <button type="button" key={item.id} className={current.id === item.id ? 'active' : ''} aria-current={current.id === item.id ? 'page' : undefined} onClick={() => navigate(item.id === 'profile' ? 'profile' : `profile:${item.id}`)}><Icon name={item.icon} size={19} /><span>{item.label}</span><Icon name="chevron-right" size={15} /></button>)}</nav></Card></aside>
      <Card className="profile-main stack"><div className="section-heading"><div><span className="eyebrow">{current.label.toUpperCase()}</span><h2>{current.title}</h2><p className="muted">{current.description}</p></div><Icon name={current.icon} size={25} /></div><div className="divider" />{current.id === 'profile' ? <ProfileEditor /> : current.id === 'resume' ? <ResumeManager /> : current.id === 'preferences' ? <PreferencesEditor /> : current.id === 'automation' ? <><AutomationPanel /><ConnectionStatus/></> : current.id === 'appearance' ? <AppearancePanel /> : current.id === 'account' ? <><AccountPanel /><SecurityControls/></> : <SupportPanel />}</Card>
    </div>
  </div>;
}
