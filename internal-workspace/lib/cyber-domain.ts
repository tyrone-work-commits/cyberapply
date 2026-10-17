import { z } from 'zod';
import type { JobSource, JobSearch, DiscoveryReport } from './job-catalog';

export const themes = ['paper', 'midnight', 'ocean', 'forest', 'ember'] as const;
export type Theme = typeof themes[number];
export type Profile = { fullName: string; email: string; skills: string[]; preferredRoles: string[]; resumeText: string; reviewed: boolean };
export type Job = { id: string; title: string; company: string; location: string; workMode: string; url: string; applyUrl?: string; source?: JobSource; description: string; skills: string[]; sample: boolean; saved: boolean; disposition: 'open' | 'passed' | 'apply_requested'; previousDisposition?: Job['disposition']; decidedAt?: string; createdAt: string };
export type Draft = { id: string; jobId: string; text: string; status: 'draft' | 'ready'; version: number; createdAt: string; updatedAt: string };
export type Attachment = { id: string; key: string; name: string; type: string; size: number; createdAt: string; textExtracted: boolean };
export type Activity = { id: string; at: string; action: string; source: 'interface' | 'agent'; message: string };
export type ResumeCheck = { title: string; points: number; possible: number; evidence: string; suggestion: string };
export type ResumeReview = { score: number; words: number; at: string; checks: ResumeCheck[] };
export type ApplicationRequest = { id: string; jobId: string; draftId: string; draftVersion: number; text: string; candidate: Profile; at: string; status: 'needs_action'; reason: 'connection_required' | 'materials_changed'; sourceUrl: string };
export type AccountProfile = { fullName: string; headline: string; targetRole: string; completedAt: string };
export type LastDecision = { jobId:string; decision:'pass'|'apply'|'save'; operationId:string; previousDisposition:Job['disposition']; previousSaved?:boolean; at:string; applicationId?:string; createdDraftId?:string };
export type State = { profile: Profile; jobs: Job[]; drafts: Draft[]; attachments: Attachment[]; theme: Theme; activity: Activity[]; resumeReview?: ResumeReview; applications?: ApplicationRequest[]; accountProfile?: AccountProfile; discovery?: { settings:JobSearch; lastSearch:DiscoveryReport }; lastDecision?:LastDecision; decisionOperations?:{id:string;signature:string}[] };
export class DomainError extends Error { constructor(message: string, public status = 400) { super(message); } }

const short = z.string().trim().max(200);
const skills = z.array(z.string().trim().min(1).max(100)).max(80);
const id = z.string().min(1).max(300);
const profile = z.object({ fullName: short, email: z.union([z.literal(''), z.string().email().max(254)]), skills, preferredRoles: z.array(short).max(20), resumeText: z.string().max(120000), reviewed: z.boolean() }).strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_profile'), profile }).strict(),
  z.object({ type: z.literal('complete_onboarding'), fullName: short.min(1), headline: short, targetRole: short.min(1) }).strict(),
  z.object({ type: z.literal('add_job'), title: short.min(1), company: short.min(1), location: short, workMode: z.enum(['Remote', 'Hybrid', 'On-site', 'Unspecified']), url: z.string().max(2000), description: z.string().trim().min(20).max(20000), skills }).strict(),
  z.object({ type: z.literal('save_job'), jobId: id, saved: z.boolean(), operationId:z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('decide_job'), jobId: id, decision: z.enum(['pass', 'apply']), operationId:z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('undo_decision'), jobId: id, decisionId:z.string().uuid().optional(), operationId:z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('edit_draft'), draftId: id, text: z.string().max(20000), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('mark_ready'), draftId: id, expectedVersion: z.number().int().positive(), confirmation: z.literal('REVIEWED') }).strict(),
  z.object({ type: z.literal('set_theme'), theme: z.enum(themes) }).strict(),
  z.object({ type: z.literal('review_resume') }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export function decisionSignature(action:Extract<Action,{type:'decide_job'|'undo_decision'|'save_job'}>){return JSON.stringify([action.type,action.jobId,action.type==='save_job'?action.saved:action.type==='decide_job'?action.decision:action.decisionId||null]);}

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
  return { score: state.profile.reviewed && job.skills.length ? Math.round(100 * matched.length / job.skills.length) : null, matched, missing, requirements: job.skills.length, basis: 'Coverage of supplied skills or recognized keywords mentioned in an imported description, compared with reviewed résumé text and declared skills. Mentions are not necessarily requirements. This is not an ATS score, a hiring probability, or verification of eligibility.' };
}
export function record(state: State, action: string, message: string, source: Activity['source'], at = new Date().toISOString()) {
  state.activity.unshift({ id: crypto.randomUUID(), at, action, message, source });
  state.activity = state.activity.slice(0, 200);
}
function getJob(state: State, jobId: string) { const job = state.jobs.find(item => item.id === jobId); if (!job) throw new DomainError('That job is not in your workspace.', 404); return job; }
function getDraft(state: State, draftId: string) { const draft = state.drafts.find(item => item.id === draftId); if (!draft) throw new DomainError('That draft is not in your workspace.', 404); return draft; }

export function reduceAction(before: State, action: Action, source: Activity['source'], at = new Date().toISOString()): { state: State; message: string } {
  const state = liveState(before);
  const operationId='operationId' in action?action.operationId:undefined;
  const signature=action.type==='decide_job'||action.type==='undo_decision'||action.type==='save_job'?decisionSignature(action):'';
  if(operationId){const previous=state.decisionOperations?.find(item=>item.id===operationId);if(previous){if(previous.signature!==signature)throw new DomainError('This choice identifier was already used for another action.',409);return {state,message:'This choice was already saved. No duplicate action was created.'};}}
  let message = '';
  if (action.type === 'complete_onboarding') {
    state.accountProfile = {fullName:action.fullName,headline:action.headline,targetRole:action.targetRole,completedAt:at};
    message = 'Your account profile is saved. Open your workspace to review your CV and explore jobs.';
  } else if (action.type === 'save_profile') {
    if (action.profile.reviewed && (!action.profile.fullName || !action.profile.email || action.profile.resumeText.trim().length < 20)) throw new DomainError('Add your name, email and résumé text before confirming the facts.');
    state.profile = {...action.profile, skills: unique(action.profile.skills), preferredRoles: unique(action.profile.preferredRoles)};
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) delete state.resumeReview;
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) state.applications?.forEach(item => { item.reason = 'materials_changed'; });
    // A changed candidate profile invalidates readiness of previously reviewed drafts.
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) state.drafts.forEach(draft => { if (draft.status === 'ready') { draft.status = 'draft'; draft.version++; draft.updatedAt = at; } });
    message = state.profile.reviewed ? 'Candidate facts reviewed and saved.' : 'Profile saved. Review the facts before applying.';
  } else if (action.type === 'add_job') {
    if (state.jobs.length >= 200) throw new DomainError('This pilot supports 200 saved listings. Export your workspace before adding more.', 409);
    const url = safeJobUrl(action.url);
    if (!url) throw new DomainError('Add the original public HTTPS job listing URL.');
    if (url && state.jobs.some(job => job.url === url)) throw new DomainError('That listing URL is already in your workspace.', 409);
    state.jobs.unshift({ id: crypto.randomUUID(), title: action.title, company: action.company, location: action.location, workMode: action.workMode, url, description: action.description, skills: unique(action.skills), sample: false, saved: false, disposition: 'open', createdAt: at });
    message = 'Listing saved with its source. Availability has not been independently verified.';
  } else if (action.type === 'save_job') {
    const job=getJob(state,action.jobId);
    if(action.saved&&!job.saved)state.lastDecision={jobId:job.id,decision:'save',operationId:operationId||crypto.randomUUID(),previousDisposition:job.disposition,previousSaved:job.saved,at};
    if(!action.saved&&state.lastDecision?.jobId===job.id&&state.lastDecision.decision==='save')delete state.lastDecision;
    job.saved = action.saved;
    message = action.saved ? 'Job saved for later.' : 'Job removed from saved listings.';
  } else if (action.type === 'decide_job') {
    const job = getJob(state, action.jobId);
    const previousDisposition=job.disposition;
    const decisionId=operationId||crypto.randomUUID();
    if (action.decision === 'apply') {
      if (job.source?.availability === 'closed') throw new DomainError('This vacancy is no longer listed on its employer board. Choose another role.', 409);
      if (!state.profile.reviewed) throw new DomainError('Review and confirm your CV and candidate facts before applying.', 409);
      if (!safeJobUrl(job.url)) throw new DomainError('Add the original job listing URL before applying.', 409);
      const existing = state.applications?.find(item => item.jobId === job.id);
      if (existing) return {state, message: 'This application already needs action in Applications. No duplicate request was created; nothing has been submitted.'};
      let draft = state.drafts.find(item => item.jobId === job.id);
      let createdDraftId:string|undefined;
      if (!draft) {
        const match = matchJob(state, job);
        const skillsSentence = match.matched.length ? `My reviewed candidate information lists ${match.matched.join(', ')}.` : 'Please review my candidate information against the requirements of this role.';
        draft = { id: `draft-${decisionId}`, jobId: job.id, text: `Dear hiring team,\n\nI am interested in the ${job.title} position at ${job.company}. ${skillsSentence}\n\nI would welcome the opportunity to discuss the role.\n\nKind regards,\n${state.profile.fullName}`, status: 'draft', version: 1, createdAt: at, updatedAt: at };
        createdDraftId=draft.id;
        state.drafts.unshift(draft);
      }
      const request: ApplicationRequest = { id: `request-${decisionId}`, jobId: job.id, draftId: draft.id, draftVersion: draft.version, text: draft.text, candidate: structuredClone(state.profile), at, status: 'needs_action', reason: 'connection_required', sourceUrl: job.url };
      state.applications = [request, ...(state.applications || [])];
      job.disposition = 'apply_requested';
      state.lastDecision={jobId:job.id,decision:'apply',operationId:decisionId,previousDisposition,at,applicationId:request.id,createdDraftId};
      message = 'Apply request saved. An approved application connection is required; no application has been sent. Open Applications for the next step.';
    } else {
      if (state.applications?.some(item => item.jobId === job.id)) throw new DomainError('An Apply request already exists for this job. Open Applications.', 409);
      job.previousDisposition = job.disposition; job.decidedAt = at; job.disposition = 'passed';
      state.lastDecision={jobId:job.id,decision:'pass',operationId:decisionId,previousDisposition,at};
      message = 'Job rejected. Undo can restore your latest choice.';
    }
  } else if (action.type === 'undo_decision') {
    const job = getJob(state, action.jobId);
    const last=state.lastDecision;
    if(!last||last.jobId!==job.id||(action.decisionId&&action.decisionId!==last.operationId))throw new DomainError('Only your latest job choice can be undone. Reload your saved workspace.',409);
    if(last.decision==='apply'){
      const request=state.applications?.find(item=>item.id===last.applicationId&&item.jobId===job.id);
      if(!request||request.status!=='needs_action')throw new DomainError('Only an unsent Apply request can be undone.',409);
      state.applications=state.applications!.filter(item=>item.id!==request.id);
      // Preserve pre-existing or edited drafts; undo never erases the user's work.
      state.drafts=state.drafts.filter(draft=>!(draft.id===last.createdDraftId&&draft.version===1&&draft.status==='draft'&&draft.text===request.text));
    }else if(last.decision==='save'){
      if(!job.saved||job.disposition!==last.previousDisposition)throw new DomainError('This saved choice changed and can no longer be undone.',409);
      job.saved=last.previousSaved??false;
    }else if(job.disposition!=='passed'||state.applications?.some(item=>item.jobId===job.id))throw new DomainError('This choice changed and can no longer be undone.',409);
    if(last.decision!=='save'){job.disposition=last.previousDisposition;delete job.previousDisposition;delete job.decidedAt;}
    delete state.lastDecision;
    message = 'Last job choice undone.';
  } else if (action.type === 'edit_draft') {
    const draft = getDraft(state, action.draftId);
    if (draft.version !== action.expectedVersion) throw new DomainError('This draft changed. Reload it before saving.', 409);
    draft.text = action.text; draft.status = 'draft'; draft.version++; draft.updatedAt = at;
    state.applications?.filter(item => item.draftId === draft.id).forEach(item => { item.reason = 'materials_changed'; });
    message = 'Draft edited and saved. Earlier versions remain in server history; review is required again.';
  } else if (action.type === 'mark_ready') {
    const draft = getDraft(state, action.draftId);
    if (draft.version !== action.expectedVersion) throw new DomainError('This draft changed. Reload it before reviewing.', 409);
    if (!state.profile.reviewed || draft.text.trim().length < 20) throw new DomainError('Review your profile and complete the draft first.', 409);
    draft.status = 'ready'; draft.version++; draft.updatedAt = at;
    message = 'Draft marked ready for manual application. It has not been submitted.';
  } else if (action.type === 'set_theme') {
    state.theme = action.theme; message = 'Appearance saved to your workspace.';
  } else if (action.type === 'review_resume') {
    if (state.profile.resumeText.trim().length < 20) throw new DomainError('Paste or import your CV text and save it before reviewing.');
    state.resumeReview = analyzeResume(state.profile, at);
    message = `CV quality review saved: ${state.resumeReview.score}/100 using six text checks. This is not an ATS score.`;
  }
  if(operationId)state.decisionOperations=[...(state.decisionOperations||[]),{id:operationId,signature}].slice(-100);
  record(state, action.type, message, source, at);
  if (JSON.stringify(state).length > 750000) throw new DomainError('The pilot workspace has reached its record limit. Export your work before continuing.', 413);
  return {state, message};
}

export function analyzeResume(profile: Profile, at = new Date().toISOString()): ResumeReview {
  const text = profile.resumeText.trim(), lines = text.split(/\n/).filter(line => line.trim()), words = text ? text.split(/\s+/).length : 0;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const name = !!profile.fullName && text.toLowerCase().includes(profile.fullName.toLowerCase());
  const sections = ['summary', 'experience', 'skills', 'education'].filter(section => new RegExp(`^\\s*${section}\\s*:?\\s*$`, 'im').test(text));
  const bullets = lines.filter(line => /^\s*[-•*]/.test(line));
  const actionLines = bullets.filter(line => /\b(investigated|built|reduced|improved|automated|documented|triaged|reviewed|monitored|implemented|led|analyzed|analysed|developed|supported)\b/i.test(line));
  const measured = bullets.filter(line => /\b\d+[\d,.]*\s*(%|hours?|minutes?|alerts?|incidents?|users?|systems?|reports?|controls?|per\b)/i.test(line));
  const covered = profile.skills.filter(skill => text.toLowerCase().includes(skill.toLowerCase()));
  const checks: ResumeCheck[] = [
    {title:'Identity and contact',points:(email?8:0)+(name?7:0),possible:15,evidence:`Name in CV: ${name?'found':'not found'}. Email in CV: ${email?'found':'not found'}.`,suggestion:'Include your name and a contact email in the CV text itself.'},
    {title:'Clear sections',points:Math.round(15*sections.length/4),possible:15,evidence:`${sections.length}/4 headings found: ${sections.join(', ')||'none'}.`,suggestion:'Use clear Summary, Experience, Skills and Education headings, where relevant.'},
    {title:'Evidence of impact',points:Math.min(20,measured.length*10),possible:20,evidence:`${measured.length} bullet(s) contain a number with a measurable unit.`,suggestion:'Add truthful scale or outcomes to relevant bullets. Never invent numbers to increase a score.'},
    {title:'Specific action bullets',points:Math.min(20,actionLines.length*5),possible:20,evidence:`${actionLines.length} bullet(s) include a recognized action verb.`,suggestion:'Explain what you investigated, built, improved or documented, using concrete examples.'},
    {title:'Declared skills in context',points:profile.skills.length?Math.round(15*covered.length/profile.skills.length):0,possible:15,evidence:`${covered.length}/${profile.skills.length} declared skills appear in the CV text.`,suggestion:'Support your relevant skills with project or experience evidence. Mention only skills you actually have.'},
    {title:'Length and scanability',points:(words>=180&&words<=900?10:words>=80&&words<=1200?5:0)+(bullets.length>=3?5:0),possible:15,evidence:`${words} words and ${bullets.length} bullet(s). Text-only review cannot inspect PDF layout.`,suggestion:'Aim for concise sections and at least three readable bullets; suitable CV length varies with experience.'},
  ];
  return {score:checks.reduce((sum,check)=>sum+check.points,0),words,at,checks};
}


export const connectionStatus = { jobDiscovery: {greenhouse:'available',lever:'available',method:'public_employer_boards',refresh:'on_request'}, applicationSubmission: 'not_connected', automaticApplications: false, message: 'Search published Greenhouse and Lever employer boards on request. Automatic employer submission requires authorized access; Apply requests are not proof of submission.' } as const;

export function liveState(input: State): State {
  const state = structuredClone(input) as State & {demo?: boolean; submissions?: unknown};
  delete state.demo; delete state.submissions;
  state.jobs = state.jobs.filter(job => !job.sample);
  const jobs = new Set(state.jobs.map(job => job.id));
  state.drafts = state.drafts.filter(draft => jobs.has(draft.jobId));
  state.applications = (state.applications || []).filter(item => jobs.has(item.jobId));
  for (const job of state.jobs) if ((job.disposition as string) === 'prepared') {
    job.disposition = 'open'; delete job.previousDisposition; delete job.decidedAt;
  }
  state.activity = state.activity.filter(item => (item.source as string) !== 'example' && !['load_examples','simulate_apply'].includes(item.action));
  return state;
}
