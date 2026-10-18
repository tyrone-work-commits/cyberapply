import { z } from 'zod';
import type { JobSource, JobSearch, DiscoveryReport } from './job-catalog';

// Legacy appearance metadata stays in saved records; the UI uses one fixed palette.
export type Theme = 'paper' | 'midnight' | 'ocean' | 'forest' | 'ember';
export type Profile = { fullName: string; email: string; skills: string[]; preferredRoles: string[]; resumeText: string; reviewed: boolean; githubRepositoryUrl?: string; linkedInUrl?: string; portfolioWebsiteUrl?: string; location?: string };
export type Job = { id: string; title: string; company: string; department?:string; location: string; workMode: string; url: string; applyUrl?: string; source?: JobSource; description: string; skills: string[]; sample: boolean; saved: boolean; disposition: 'open' | 'passed' | 'apply_requested'; previousDisposition?: Job['disposition']; decidedAt?: string; createdAt: string };
export type Draft = { id: string; jobId: string; text: string; status: 'draft' | 'ready'; version: number; createdAt: string; updatedAt: string };
export type Attachment = { id: string; key: string; name: string; type: string; size: number; createdAt: string; textExtracted: boolean; reviewSnapshot?:{score:number;at:string} };
export type Activity = { id: string; at: string; action: string; source: 'interface' | 'agent'; message: string };
export type ResumeCheck = { title: string; points: number; possible: number; evidence: string; suggestion: string };
export type ResumeReview = { score: number; words: number; at: string; checks: ResumeCheck[]; source?:{fileId:string;name:string;format:'PDF'|'DOCX'|'TXT';pages?:number;warnings:string[]} };
export function fileReviewScore(file:Attachment,review?:ResumeReview){
 if(review?.source?.fileId===file.id)return{score:review.score,at:review.at};
 return file.reviewSnapshot;
}
function saveFileReview(state:State){
 const review=state.resumeReview;
 if(!review?.source)return;
 const file=state.attachments.find(item=>item.id===review.source?.fileId);
 if(file)file.reviewSnapshot={score:review.score,at:review.at};
}
export type ApplicationRequest = { id: string; jobId: string; draftId: string; draftVersion: number; text: string; candidate: Profile; at: string; status: 'needs_action'; reason: 'connection_required' | 'candidate_review_required' | 'materials_changed'; sourceUrl: string };
export type AccountProfile = { fullName: string; headline: string; targetRole: string; completedAt: string };
export type LastDecision = { jobId:string; decision:'pass'|'apply'|'save'; operationId:string; previousDisposition:Job['disposition']; previousSaved?:boolean; at:string; applicationId?:string; createdDraftId?:string };
export type State = { profile: Profile; jobs: Job[]; drafts: Draft[]; attachments: Attachment[]; pendingFileDeletions?:Attachment[]; theme: Theme; activity: Activity[]; resumeReview?: ResumeReview; applications?: ApplicationRequest[]; accountProfile?: AccountProfile; discovery?: { settings:JobSearch; lastSearch:DiscoveryReport }; lastDecision?:LastDecision; decisionOperations?:{id:string;signature:string}[] };
export class DomainError extends Error { constructor(message: string, public status = 400) { super(message); } }

const short = z.string().trim().max(200);
const skills = z.array(z.string().trim().min(1).max(100)).max(80);
const id = z.string().min(1).max(300);
const candidateLink = z.string().trim().max(2000).refine(value => { try { return !value || Boolean(safeJobUrl(value)); } catch { return false; } }, 'Use a public https:// link.').optional();
const profile = z.object({ fullName: short, email: z.union([z.literal(''), z.string().email().max(254)]), skills, preferredRoles: z.array(short).max(20), resumeText: z.string().max(120000), reviewed: z.boolean(), githubRepositoryUrl: candidateLink, linkedInUrl: candidateLink, portfolioWebsiteUrl: candidateLink, location: short.optional() }).strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save_profile'), profile }).strict(),
  z.object({ type: z.literal('complete_onboarding'), fullName: short.min(1), headline: short, targetRole: short.min(1) }).strict(),
  z.object({ type: z.literal('add_job'), title: short.min(1), company: short.min(1), location: short, workMode: z.enum(['Remote', 'Hybrid', 'On-site', 'Unspecified']), url: z.string().max(2000), description: z.string().trim().min(20).max(20000), skills }).strict(),
  z.object({ type: z.literal('save_job'), jobId: id, saved: z.boolean(), operationId:z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('decide_job'), jobId: id, decision: z.enum(['pass', 'apply']), operationId:z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('undo_decision'), jobId: id, decisionId:z.string().uuid().optional(), operationId:z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('edit_draft'), draftId: id, text: z.string().max(20000), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('mark_ready'), draftId: id, expectedVersion: z.number().int().positive(), confirmation: z.literal('REVIEWED') }).strict(),
  z.object({ type: z.literal('review_resume') }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export function decisionSignature(action:Extract<Action,{type:'decide_job'|'undo_decision'|'save_job'}>){return JSON.stringify([action.type,action.jobId,action.type==='save_job'?action.saved:action.type==='decide_job'?action.decision:action.decisionId||null]);}

export function emptyState(email = ''): State {
  return { profile: { fullName: '', email, skills: [], preferredRoles: [], resumeText: '', reviewed: false, githubRepositoryUrl: '', linkedInUrl: '', portfolioWebsiteUrl: '', location: '' }, jobs: [], drafts: [], attachments: [], theme: 'paper', activity: [] };
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
    state.profile = {...state.profile, ...action.profile, skills: unique(action.profile.skills), preferredRoles: unique(action.profile.preferredRoles)};
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) {
      state.resumeReview=state.profile.resumeText.trim().length>=20?analyzeResume(state.profile,at):undefined;
      if(state.resumeReview&&state.profile.resumeText===before.profile.resumeText&&before.resumeReview?.source)state.resumeReview.source=structuredClone(before.resumeReview.source);
      saveFileReview(state);
    }
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) state.applications?.forEach(item => { item.reason = 'materials_changed'; });
    // A changed candidate profile invalidates readiness of previously reviewed drafts.
    if (JSON.stringify(state.profile) !== JSON.stringify(before.profile)) state.drafts.forEach(draft => { if (draft.status === 'ready') { draft.status = 'draft'; draft.version++; draft.updatedAt = at; } });
    message = state.profile.reviewed ? 'Candidate facts reviewed and saved.' : 'Profile saved. Review the facts before using application materials.';
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
      if (!safeJobUrl(job.url)) throw new DomainError('Add the original job listing URL before applying.', 409);
      const existing = state.applications?.find(item => item.jobId === job.id);
      if (existing) return {state, message: 'This application already needs action in Applications. No duplicate request was created; nothing has been submitted.'};
      let draft = state.drafts.find(item => item.jobId === job.id);
      let createdDraftId:string|undefined;
      if (!draft) {
        const match = matchJob(state, job);
        const skillsSentence = state.profile.reviewed && match.matched.length ? `My reviewed candidate information lists ${match.matched.join(', ')}.` : 'I will review my candidate information against the requirements of this role.';
        draft = { id: `draft-${decisionId}`, jobId: job.id, text: `Dear hiring team,\n\nI am interested in the ${job.title} position at ${job.company}. ${skillsSentence}\n\nI would welcome the opportunity to discuss the role.\n\nKind regards,\n${state.profile.fullName||'[Your name]'}`, status: 'draft', version: 1, createdAt: at, updatedAt: at };
        createdDraftId=draft.id;
        state.drafts.unshift(draft);
      }
      const request: ApplicationRequest = { id: `request-${decisionId}`, jobId: job.id, draftId: draft.id, draftVersion: draft.version, text: draft.text, candidate: structuredClone(state.profile), at, status: 'needs_action', reason: state.profile.reviewed?'connection_required':'candidate_review_required', sourceUrl: job.url };
      state.applications = [request, ...(state.applications || [])];
      job.disposition = 'apply_requested';
      state.lastDecision={jobId:job.id,decision:'apply',operationId:decisionId,previousDisposition,at,applicationId:request.id,createdDraftId};
      message = state.profile.reviewed?'Apply request saved in Applications. An approved connection is required; no application has been sent.':'Apply request saved in Applications. Review your candidate facts and CV before using the materials; no application has been sent.';
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
  } else if (action.type === 'review_resume') {
    if (state.profile.resumeText.trim().length < 20) throw new DomainError('Paste or import your CV text and save it before reviewing.');
    const reviewSource=state.resumeReview?.source;
    state.resumeReview = analyzeResume(state.profile, at);
    if(reviewSource)state.resumeReview.source=reviewSource;
    saveFileReview(state);
    message = `CV readiness review saved: ${state.resumeReview.score}/100 using six explainable text checks. Employer ATS scores can differ.`;
  }
  if(operationId)state.decisionOperations=[...(state.decisionOperations||[]),{id:operationId,signature}].slice(-100);
  record(state, action.type, message, source, at);
  if (JSON.stringify(state).length > 750000) throw new DomainError('The pilot workspace has reached its record limit. Export your work before continuing.', 413);
  return {state, message};
}

export function analyzeResume(profile: Profile, at = new Date().toISOString()): ResumeReview {
  const text=profile.resumeText.trim(),lines=text.split(/\n/).map(line=>line.trim()).filter(Boolean),words=text?text.split(/\s+/).length:0;
  const email=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const phone=lines.slice(0,8).some(line=>(line.match(/\+?\(?\d[\d ()\-.]{5,}\d/g)||[]).some(value=>{const count=value.replace(/\D/g,'').length;return count>=7&&count<=15&&!/^\d{4}\s*[-–]\s*\d{4}$/.test(value.trim());}));
  const groups:[string,string][]=[['Summary','summary|professional summary|profile|professional profile|objective'],['Experience','experience|work experience|professional experience|employment history|work history|projects|project experience'],['Skills','skills|technical skills|core skills|core competencies|technologies'],['Education','education|qualifications|education and certifications|education & certifications']];
  const found=groups.filter(([,names])=>new RegExp(`^\\s*(?:${names})\\s*(?::.*)?$`,'im').test(text));
  const missing=groups.filter(group=>!found.includes(group)).map(([name])=>name);
  const bullets=lines.filter(line=>/^(?:[-•*●▪◦‣–—]|\d+[.)])\s+/.test(line));
  const actionPattern=/\b(investigated|built|reduced|improved|automated|documented|triaged|reviewed|monitored|implemented|led|analyzed|analysed|developed|supported|configured|secured|detected|resolved|responded|assessed|managed|tested|remediated)\b/i;
  const actionLines=bullets.filter(line=>actionPattern.test(line));
  const measured=bullets.filter(line=>/\b\d+[\d,.]*\s*(%|hours?|minutes?|alerts?|incidents?|users?|systems?|reports?|controls?|endpoints?|vulnerabilities|per\b)/i.test(line));
  const keywords=['SIEM','Splunk','Python','Linux','AWS','Azure','Incident response','Threat hunting','Vulnerability management','Penetration testing','IAM','NIST','ISO 27001','Security monitoring','EDR','SQL','Networking','Firewalls','SOC'];
  const has=(value:string,where:string)=>new RegExp(`(^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(where);
  const declared=profile.skills.length?unique(profile.skills):keywords.filter(skill=>has(skill,text));
  const covered=declared.filter(skill=>has(skill,text));
  const context=covered.filter(skill=>lines.some(line=>actionPattern.test(line)&&has(skill,line)));
  const coverage=profile.skills.length?covered.length/profile.skills.length:Math.min(1,covered.length/4);
  const checks:ResumeCheck[]=[
    {title:'Contact details',points:(email?10:0)+(phone?5:0),possible:15,evidence:`Email address: ${email?'found':'not found'}. Phone-like number: ${phone?'found':'not found'}.`,suggestion:`Add ${!email&&!phone?'a contact email and phone number':!email?'a contact email':'a contact phone number'} as readable text in your CV header. Check that the details are current.`},
    {title:'Clear sections',points:Math.round(15*found.length/4),possible:15,evidence:`${found.length}/4 section types found: ${found.map(([name])=>name).join(', ')||'none'}.`,suggestion:`Add clear ${missing.join(', ')} headings where relevant. Use projects to demonstrate experience if you are early in your career.`},
    {title:'Evidence of impact',points:Math.min(20,measured.length*10),possible:20,evidence:`${measured.length} bullet(s) include a number with a recognized measure.`,suggestion:'Add truthful scope or outcomes to relevant experience bullets: alerts reviewed, systems supported, time saved or incidents handled. Use numbers only when you can support them.'},
    {title:'Specific action bullets',points:Math.min(20,actionLines.length*5),possible:20,evidence:`${actionLines.length} bullet(s) describe a recognized action.`,suggestion:'Start experience or project bullets with a specific action and explain what you did. For example: Investigated [type of incident] using [tool], then documented [your actual findings]. Replace brackets only with facts.'},
    {title:'Skills with evidence',points:Math.round(8*coverage)+Math.min(7,context.length*4),possible:15,evidence:`${covered.length} ${profile.skills.length?'of '+profile.skills.length+' declared skills':'recognized cybersecurity skills'} found; ${context.length} appear in action-oriented lines.`,suggestion:'List relevant tools and skills that you actually have, then show where you used them in experience or projects. Avoid repeating keywords without evidence.'},
    {title:'Length and readability',points:(words>=180&&words<=900?10:words>=80&&words<=1200?5:0)+(bullets.length>=3?5:0),possible:15,evidence:`${words} words; ${bullets.length} readable bullet(s). Graphics and visual layout are not scored.`,suggestion:[words<180?'Add concise, relevant experience or project detail. CV length depends on experience; avoid padding.':words>900?'Keep the strongest relevant content and remove repetition. CV length depends on experience.':'Keep your content concise and relevant.',bullets.length<3?'Use at least three readable bullets for experience or projects.':'Your bullet structure is readable; check that a plain-text copy reads in the right order.'].join(' ')},
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
