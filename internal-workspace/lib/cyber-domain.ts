import { z } from 'zod';

export const themes = ['paper', 'midnight', 'ocean', 'forest', 'ember'] as const;
export type Theme = typeof themes[number];
export type Profile = { fullName: string; email: string; skills: string[]; preferredRoles: string[]; resumeText: string; reviewed: boolean };
export type Job = { id: string; title: string; company: string; location: string; workMode: string; url: string; description: string; skills: string[]; sample: boolean; saved: boolean; disposition: 'open' | 'passed' | 'prepared'; previousDisposition?: Job['disposition']; decidedAt?: string; createdAt: string };
export type Draft = { id: string; jobId: string; text: string; status: 'draft' | 'ready'; version: number; createdAt: string; updatedAt: string };
export type Attachment = { id: string; key: string; name: string; type: string; size: number; createdAt: string; textExtracted: boolean };
export type Activity = { id: string; at: string; action: string; source: 'interface' | 'agent'; message: string };
export type State = { profile: Profile; jobs: Job[]; drafts: Draft[]; attachments: Attachment[]; theme: Theme; activity: Activity[] };
export class DomainError extends Error { constructor(message: string, public status = 400) { super(message); } }

const short = z.string().trim().max(200);
const skills = z.array(z.string().trim().min(1).max(100)).max(80);
const id = z.string().min(1).max(100);
const profile = z.object({ fullName: short, email: z.union([z.literal(''), z.string().email().max(254)]), skills, preferredRoles: z.array(short).max(20), resumeText: z.string().max(120000), reviewed: z.boolean() }).strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_profile'), profile }).strict(),
  z.object({ type: z.literal('load_examples') }).strict(),
  z.object({ type: z.literal('add_job'), title: short.min(1), company: short.min(1), location: short, workMode: z.enum(['Remote', 'Hybrid', 'On-site', 'Unspecified']), url: z.string().max(2000), description: z.string().trim().min(20).max(20000), skills }).strict(),
  z.object({ type: z.literal('save_job'), jobId: id, saved: z.boolean() }).strict(),
  z.object({ type: z.literal('decide_job'), jobId: id, decision: z.enum(['pass', 'prepare']) }).strict(),
  z.object({ type: z.literal('undo_decision'), jobId: id }).strict(),
  z.object({ type: z.literal('edit_draft'), draftId: id, text: z.string().max(20000), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('mark_ready'), draftId: id, expectedVersion: z.number().int().positive(), confirmation: z.literal('REVIEWED') }).strict(),
  z.object({ type: z.literal('set_theme'), theme: z.enum(themes) }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;

export function emptyState(email = ''): State {
  return { profile: { fullName: '', email, skills: [], preferredRoles: [], resumeText: '', reviewed: false }, jobs: [], drafts: [], attachments: [], theme: 'paper', activity: [] };
}
export function safeJobUrl(value: string) {
  if (!value) return '';
  let url: URL;
  try { url = new URL(value); } catch { throw new DomainError('Use a valid https:// employer listing URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local') || host.startsWith('[')) throw new DomainError('Use a public HTTPS employer listing URL without embedded credentials.');
  return url.href;
}
function unique(values: string[]) { return [...new Map(values.map(value => [value.toLowerCase(), value])).values()]; }
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').replace(/\.(?=\s|$)/g,' ').trim(); }
export function matchJob(state: State, job: Job) {
  const declared = state.profile.skills.map(normalize);
  const text = ` ${normalize(state.profile.resumeText)} `;
  const matched = job.skills.filter(skill => declared.includes(normalize(skill)) || text.includes(` ${normalize(skill)} `));
  const missing = job.skills.filter(skill => !matched.includes(skill));
  return { score: state.profile.reviewed && job.skills.length ? Math.round(100 * matched.length / job.skills.length) : null, matched, missing, requirements: job.skills.length, basis: 'Coverage of the listing skills you entered, compared with reviewed résumé text and declared skills. This is not an ATS score, a hiring probability, or verification of eligibility.' };
}
export function record(state: State, action: string, message: string, source: Activity['source'], at = new Date().toISOString()) {
  state.activity.unshift({ id: crypto.randomUUID(), at, action, message, source });
  state.activity = state.activity.slice(0, 200);
}
function getJob(state: State, jobId: string) { const job = state.jobs.find(item => item.id === jobId); if (!job) throw new DomainError('That job is not in your workspace.', 404); return job; }
function getDraft(state: State, draftId: string) { const draft = state.drafts.find(item => item.id === draftId); if (!draft) throw new DomainError('That draft is not in your workspace.', 404); return draft; }

export function reduceAction(before: State, action: Action, source: Activity['source'], at = new Date().toISOString()): { state: State; message: string } {
  const state = structuredClone(before);
  let message = '';
  if (action.type === 'save_profile') {
    if (action.profile.reviewed && (!action.profile.fullName || !action.profile.email || action.profile.resumeText.trim().length < 20)) throw new DomainError('Add your name, email and résumé text before confirming the facts.');
    state.profile = {...action.profile, skills: unique(action.profile.skills), preferredRoles: unique(action.profile.preferredRoles)};
    // A changed candidate profile invalidates readiness of previously reviewed drafts.
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) state.drafts.forEach(draft => { if (draft.status === 'ready') { draft.status = 'draft'; draft.version++; draft.updatedAt = at; } });
    message = state.profile.reviewed ? 'Candidate facts reviewed and saved.' : 'Profile saved. Review the facts before preparing applications.';
  } else if (action.type === 'load_examples') {
    const examples = [
      ['soc', 'SOC Analyst', 'Example Sentinel', 'London, UK', 'Hybrid', ['SIEM', 'Incident response', 'Splunk'], 'Triage security alerts, investigate incidents and document response decisions. This is a fictional listing for demonstrating the workflow.'],
      ['cloud', 'Cloud Security Engineer', 'Example Cloudworks', 'Remote', 'Remote', ['AWS', 'IAM', 'Terraform'], 'Review cloud access, infrastructure changes and security controls. This is a fictional listing for demonstrating the workflow.'],
      ['grc', 'GRC Analyst', 'Example Assurance', 'Lagos, Nigeria', 'Hybrid', ['ISO 27001', 'Risk assessment', 'Compliance'], 'Support risk assessments and document evidence for control reviews. This is a fictional listing for demonstrating the workflow.'],
      ['appsec', 'Application Security Engineer', 'Example Securebuild', 'Remote', 'Remote', ['Threat modeling', 'Python', 'OWASP'], 'Work with developers on application risks and secure design reviews. This is a fictional listing for demonstrating the workflow.'],
    ] as const;
    for (const [key, title, company, location, workMode, required, description] of examples) if (!state.jobs.some(job => job.id === `sample-${key}`)) state.jobs.push({ id: `sample-${key}`, title, company, location, workMode, skills: [...required], description, url: '', sample: true, saved: false, disposition: 'open', createdAt: at });
    message = 'Fictional sample jobs added. Your profile and existing jobs were preserved.';
  } else if (action.type === 'add_job') {
    if (state.jobs.length >= 200) throw new DomainError('This pilot supports 200 saved listings. Export your workspace before adding more.', 409);
    const url = safeJobUrl(action.url);
    if (url && state.jobs.some(job => job.url === url)) throw new DomainError('That listing URL is already in your workspace.', 409);
    state.jobs.unshift({ id: crypto.randomUUID(), title: action.title, company: action.company, location: action.location, workMode: action.workMode, url, description: action.description, skills: unique(action.skills), sample: false, saved: false, disposition: 'open', createdAt: at });
    message = 'Listing saved as provided. Its source and availability have not been independently verified.';
  } else if (action.type === 'save_job') {
    getJob(state, action.jobId).saved = action.saved;
    message = action.saved ? 'Job saved for later.' : 'Job removed from saved listings.';
  } else if (action.type === 'decide_job') {
    const job = getJob(state, action.jobId);
    if (action.decision === 'prepare' && !state.profile.reviewed) throw new DomainError('Review and confirm your candidate facts in Workspace first.', 409);
    const existing = state.drafts.find(draft => draft.jobId === job.id);
    if (action.decision === 'prepare' && existing) return {state, message: 'Your existing draft is available in Applications. A duplicate was not created.'};
    job.previousDisposition = job.disposition;
    job.decidedAt = at;
    job.disposition = action.decision === 'pass' ? 'passed' : 'prepared';
    if (action.decision === 'prepare') {
      const match = matchJob(state, job);
      const skillsSentence = match.matched.length ? `My reviewed candidate information lists ${match.matched.join(', ')}.` : 'Please review my candidate information against the requirements of this role.';
      state.drafts.unshift({ id: crypto.randomUUID(), jobId: job.id, text: `Dear hiring team,\n\nI am interested in the ${job.title} position at ${job.company}. ${skillsSentence}\n\nI would welcome the opportunity to discuss the role.\n\nKind regards,\n${state.profile.fullName}`, status: 'draft', version: 1, createdAt: at, updatedAt: at });
      message = 'Application draft prepared from reviewed facts. No employer was contacted.';
    } else message = 'Job passed. You can undo this choice for five seconds.';
  } else if (action.type === 'undo_decision') {
    const job = getJob(state, action.jobId);
    const elapsed = Date.parse(at) - Date.parse(job.decidedAt || '');
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000 || !job.previousDisposition) throw new DomainError('The five-second Undo window has ended.', 409);
    if (job.disposition === 'prepared') {
      const draft = state.drafts.find(item => item.jobId === job.id);
      if (draft && (draft.version !== 1 || draft.status !== 'draft')) throw new DomainError('This draft has been edited or reviewed and cannot be undone.', 409);
      state.drafts = state.drafts.filter(item => item.jobId !== job.id);
    }
    job.disposition = job.previousDisposition; delete job.previousDisposition; delete job.decidedAt;
    message = 'Last job choice undone.';
  } else if (action.type === 'edit_draft') {
    const draft = getDraft(state, action.draftId);
    if (draft.version !== action.expectedVersion) throw new DomainError('This draft changed. Reload it before saving.', 409);
    draft.text = action.text; draft.status = 'draft'; draft.version++; draft.updatedAt = at;
    message = 'Draft edited and saved. Earlier versions remain in server history; review is required again.';
  } else if (action.type === 'mark_ready') {
    const draft = getDraft(state, action.draftId);
    if (draft.version !== action.expectedVersion) throw new DomainError('This draft changed. Reload it before reviewing.', 409);
    if (!state.profile.reviewed || draft.text.trim().length < 20) throw new DomainError('Review your profile and complete the draft first.', 409);
    draft.status = 'ready'; draft.version++; draft.updatedAt = at;
    message = 'Draft marked ready for manual application. It has not been submitted.';
  } else if (action.type === 'set_theme') {
    state.theme = action.theme; message = 'Appearance saved to your workspace.';
  }
  record(state, action.type, message, source, at);
  if (JSON.stringify(state).length > 750000) throw new DomainError('The pilot workspace has reached its record limit. Export your work before continuing.', 413);
  return {state, message};
}
