import {enrichJob} from './job-extraction';
import {configuredSearch} from './job-source-preferences';
import {recordingPrefix} from './application-recordings';
import {watchStorageKeys} from './agent-watch-storage';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { actionSchema, emptyState, liveState, retireLocalAgent, DomainError, reduceAction, record, workspacePayload, type State, type Activity, type Attachment } from './cyber-domain';
import { deletionPlan, deletionHistoryExpression, type DeletionScope } from './application-deletion';
import { extractCandidateFacts } from './candidate-facts';
import { extractResume } from './resume-extraction';
import { discover, mergeDiscovery } from './job-discovery';
import { defaultSearch } from './job-catalog';
import {fetchEmployerQuestions,mergeEmployerQuestionChoices} from './employer-question-options';
import { liveSearchCooldown, type SearchCooldown } from './search-cooldown';
import {verifyEmployerReceipts,applyVerifiedReceipts,type ReceiptMail} from './employer-receipts';

export type Identity = { userId: string; email: string; displayName: string };
export type Snapshot = { revision: number; updatedAt: string; state: State; searchCooldown:SearchCooldown };
class SearchCooldownError extends DomainError {
  constructor(public cooldown:SearchCooldown){super('Live search is temporarily paused. Your last results are saved.',429);}
}
function db() { if (!env.DB) throw new DomainError('Workspace storage is unavailable.', 503); return env.DB; }
export function workspaceIdentity(user: Identity, mode: unknown): Identity {
  if (mode === 'demo') throw new DomainError('This workspace is no longer available. Open your own workspace.', 410);
  if (mode !== undefined && mode !== null && mode !== 'personal') throw new DomainError('Unknown workspace.');
  return user;
}
export async function identity(request?: Request): Promise<Identity> { const user = await getChatGPTUser(); if (!user) throw new DomainError('Sign in with ChatGPT to access your private workspace.', 401); return workspaceIdentity(user,request?new URL(request.url).searchParams.get('mode'):undefined); }
export async function load(user: Identity): Promise<Snapshot> {
  const now = new Date().toISOString();
  await db().prepare('INSERT OR IGNORE INTO cyber_workspaces (owner_id,revision,payload,write_token,updated_at) VALUES (?,0,?,?,?)').bind(user.userId, JSON.stringify(emptyState(user.email)), crypto.randomUUID(), now).run();
  const row = await db().prepare('SELECT revision,payload,updated_at FROM cyber_workspaces WHERE owner_id=?').bind(user.userId).first<{revision:number;payload:string;updated_at:string}>();
  if (!row) throw new DomainError('Workspace could not be loaded.', 503);
  const stored=JSON.parse(row.payload);
  if(stored.__deleting===true)throw new DomainError('Your CyberApply account deletion is in progress. Open Account to retry cleanup.',409);
  const state=retireLocalAgent(stored);state.jobs=state.jobs.map(job=>job.extracted?job:enrichJob(job));
  return {revision:row.revision, updatedAt:row.updated_at, state, searchCooldown:liveSearchCooldown(state.discovery?.lastSearch.at)};
}
export async function save(user: Identity, expected: number, state: State, action: string): Promise<Snapshot> {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new DomainError('A current workspace revision is required.');
  state.jobs=state.jobs.map(job=>job.extracted?job:enrichJob(job));
  const revision = expected + 1, at = new Date().toISOString(), token = crypto.randomUUID(), payload = workspacePayload(state);
  const results = await db().batch([
    db().prepare("UPDATE cyber_workspaces SET payload=?,revision=?,write_token=?,updated_at=? WHERE owner_id=? AND revision=? AND json_extract(payload,'$.__deleting') IS NULL").bind(payload,revision,token,at,user.userId,expected),
    db().prepare('INSERT INTO cyber_revisions (owner_id,revision,payload,action,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM cyber_workspaces WHERE owner_id=? AND write_token=?)').bind(user.userId,revision,payload,action,at,user.userId,token),
  ]);
  if (results[0].meta.changes !== 1) throw new DomainError('Your workspace changed in another window or tool. Reload before trying again; your previous work is safe.', 409);
  return {revision,updatedAt:at,state,searchCooldown:liveSearchCooldown(state.discovery?.lastSearch.at)};
}
export async function act(user: Identity, expected: number, input: unknown, source: Activity['source']) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  if(parsed.data.type==='save_profile')throw new DomainError('The old Candidate Facts editor and manual review have been permanently retired. Use Edit Profile for personal details and CV review for your chosen file.',410);
  const current = await load(user);
  if (current.revision !== expected) throw new DomainError('Your workspace changed. Reload before saving.', 409);
  const result = reduceAction(current.state, parsed.data, source);
  return {...await save(user, expected, result.state, parsed.data.type),message:result.message};
}

export async function refreshEmployerQuestionChoices(user:Identity,expected:number,questionId:string){
 const current=await load(user);
 if(current.revision!==expected)throw new DomainError('Your workspace changed. Reload before refreshing choices.',409);
 const question=current.state.accountProfile?.employerQuestions?.find(q=>q.id===questionId);
 const job=current.state.jobs.find(j=>j.id===question?.jobId);
 if(!question||!job)throw new DomainError('The original question and vacancy are no longer available.',404);
 const rows=await fetchEmployerQuestions(job);
 const message=mergeEmployerQuestionChoices(current.state,questionId,rows,new Date().toISOString());
 return {...await save(user,expected,current.state,'refresh_employer_question_choices'),message};
}

export async function setReceiptChecking(user:Identity,enabled:boolean){
 for(let attempt=0;attempt<3;attempt++){
  const current=await load(user);if(!!current.state.receiptChecksEnabled===enabled)return current;
  current.state.receiptChecksEnabled=enabled;
  record(current.state,'receipt_check_settings',`Automatic employer receipt checks ${enabled?'enabled':'disabled'}.`,'interface');
  try{return await save(user,current.revision,current.state,'receipt_check_settings');}catch(error){if(error instanceof DomainError&&error.status===409)continue;throw error;}
 }
 throw new DomainError('Your workspace changed. Try the receipt-check setting again.',409);
}
export async function claimReceiptCheck(user:Identity,now=Date.now()){
 const result=await db().prepare('INSERT INTO cyber_receipt_checks (owner_id,next_check_at) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET next_check_at=excluded.next_check_at WHERE cyber_receipt_checks.next_check_at<=?').bind(user.userId,now+120000,now).run();
 if(result.meta.changes===1)return 0;
 const row=await db().prepare('SELECT next_check_at FROM cyber_receipt_checks WHERE owner_id=?').bind(user.userId).first<{next_check_at:number}>();
 return Math.max(1000,(row?.next_check_at||now+120000)-now);
}
export async function reconcileReceiptMessages(user:Identity,mailbox:string,messages:ReceiptMail[]){
 if(mailbox.toLowerCase()!==user.email.toLowerCase())throw new DomainError('The connected mailbox must match your CyberApply sign-in.',403);
 for(let attempt=0;attempt<3;attempt++){
  const current=await load(user),at=new Date().toISOString();
  const matches=verifyEmployerReceipts(messages,current.state,mailbox,Date.parse(at));
  const confirmed=applyVerifiedReceipts(current.state,matches,at);
  if(!confirmed.length)return{...current,confirmed};
  record(current.state,'employer_email_confirmation',`Verified ${confirmed.length} employer application receipt${confirmed.length===1?'':'s'} from the connected mailbox.`,'agent',at);
  try{return{...await save(user,current.revision,current.state,'employer_email_confirmation'),confirmed};}catch(error){if(error instanceof DomainError&&error.status===409)continue;throw error;}
 }
 throw new DomainError('Your workspace changed while checking receipts. No application will be retried.',409);
}
export async function permanentlyDeleteApplications(user:Identity,expected:number,scope:DeletionScope,applicationId?:string,deleteCandidateFacts=false){
 const current=await load(user);
 if(current.revision!==expected)throw new DomainError('Your workspace changed. Reload before permanently deleting records.',409);
 const legacy=scope==='candidate_facts'||deleteCandidateFacts;
 let replacement=emptyState().profile;
 if(legacy&&current.state.selectedCvId){
  const file=current.state.attachments.find(item=>item.id===current.state.selectedCvId);
  if(file){const object=await files().get(file.key);if(!object)throw new DomainError('The selected CV is unavailable. No records were deleted.',409);
   const extracted=await extractResume(new Uint8Array(await object.arrayBuffer()),file.name);
   replacement={...replacement,...extractCandidateFacts(extracted.text),resumeText:extracted.text,reviewed:false};
  }
 }
 const plan=deletionPlan(current.state,scope,applicationId,deleteCandidateFacts,replacement);
 if(plan.ids.length)await files().delete(plan.ids.flatMap(id=>watchStorageKeys(user.userId,id).all));
 for(const id of plan.ids){while(true){const page=await files().list({prefix:recordingPrefix(user.userId,id),limit:1000});const keys=page.objects.map(object=>object.key);if(!keys.length)break;await files().delete(keys);}}
 const at=new Date().toISOString(),revision=expected+1,token=crypto.randomUUID();
 record(plan.state,'permanently_delete_application_records',`Permanently deleted ${plan.ids.length} application records and ${plan.draftIds.length} drafts${plan.legacy?' and retired legacy Candidate Facts reviews':''}.`,'interface',at);
 const payload=workspacePayload(plan.state);
 const redaction=deletionHistoryExpression(plan.ids,plan.draftIds,plan.legacy);
 const guard='EXISTS (SELECT 1 FROM cyber_workspaces WHERE owner_id=? AND write_token=?)';
 const results=await db().batch([
  db().prepare("UPDATE cyber_workspaces SET payload=?,revision=?,write_token=?,updated_at=? WHERE owner_id=? AND revision=? AND json_extract(payload,'$.__deleting') IS NULL").bind(payload,revision,token,at,user.userId,expected),
  db().prepare(`WITH redacted AS (SELECT owner_id,revision,${redaction.expression} AS clean FROM cyber_revisions WHERE owner_id=? AND ${guard}) UPDATE cyber_revisions SET payload=(SELECT CASE WHEN json_array_length(clean,'$.applicationArchive.applications')=0 AND json_array_length(clean,'$.applicationArchive.drafts')=0 THEN json_remove(clean,'$.applicationArchive','$.lastDecision') ELSE json_remove(clean,'$.lastDecision') END FROM redacted WHERE redacted.owner_id=cyber_revisions.owner_id AND redacted.revision=cyber_revisions.revision) WHERE owner_id=? AND ${guard}`).bind(...redaction.params,user.userId,user.userId,token,user.userId,user.userId,token),
  db().prepare(`INSERT INTO cyber_revisions (owner_id,revision,payload,action,created_at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(user.userId,revision,payload,'permanently_delete_application_records',at,user.userId,token),
 ]);
 if(results[0].meta.changes!==1)throw new DomainError('Your workspace changed. Reload before permanently deleting records.',409);
 const coverKeys=[...(current.state.applications||[]),...(current.state.applicationArchive?.applications||[])].filter(item=>plan.ids.includes(item.id)).map(item=>item.coverLetter?.key).filter((key):key is string=>!!key&&key.startsWith(`owners/${encodeURIComponent(user.userId)}/career/application-letter-`));if(coverKeys.length)try{await files().delete(coverKeys);}catch{console.error('Deleted application cover-file cleanup pending under owner prefix.');}
 return {revision,updatedAt:at,state:plan.state,searchCooldown:liveSearchCooldown(plan.state.discovery?.lastSearch.at),message:'Records permanently deleted from your workspace and saved versions. This does not withdraw employer applications or delete original CV files.'};
}
export function sourceSecrets(){const value=(env as unknown as Record<string,string|undefined>).RECRUITEE_BOARD_TOKENS;if(!value)return {};try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};return{recruitee:Object.fromEntries(Object.entries(parsed).filter(([board,token])=>/^[a-z0-9][a-z0-9-]{0,79}$/.test(board)&&typeof token==='string'&&token.length<=2000&&!/[\r\n]/.test(token)) as [string,string][])};}catch{return {};}}
export async function discoverJobs(user:Identity,expected:number,settings:unknown,source:Activity['source']) {
  if(!Number.isSafeInteger(expected)||expected<0)throw new DomainError('A current numeric workspace revision is required.');
  const current=await load(user);
  if(current.revision!==expected)throw new DomainError('Your workspace changed. Reload before searching.',409);
  if(current.searchCooldown.remainingMs>0)throw new SearchCooldownError(current.searchCooldown);
  const effective=await configuredSearch(user,settings,current.state.discovery?.settings??defaultSearch);
  const result=await discover(effective,fetch,new Date().toISOString(),sourceSecrets());
  const merged=mergeDiscovery(current.state,result.settings,result.results,result.at,source);
  return {...await save(user,expected,merged.state,'discover_jobs'),message:merged.message,report:merged.report};
}
export async function history(user: Identity, before = 2147483647) {
  await ensureAccountActive(user);
  const rows = await db().prepare('SELECT revision,action,created_at FROM cyber_revisions WHERE owner_id=? AND revision<? ORDER BY revision DESC LIMIT 30').bind(user.userId,before).all();
  return rows.results.filter(item => !['load_examples','simulate_apply'].includes(String(item.action)));
}
export async function revision(user: Identity, number: number) {
  await ensureAccountActive(user);
  const row = await db().prepare('SELECT revision,payload,action,created_at FROM cyber_revisions WHERE owner_id=? AND revision=?').bind(user.userId,number).first<{revision:number;payload:string;action:string;created_at:string}>();
  if (!row) throw new DomainError('That saved version is not in your workspace.',404);
  return {revision:row.revision,state:liveState(JSON.parse(row.payload)) as State,action:row.action,at:row.created_at};
}
export function files() { if (!env.BUCKET) throw new DomainError('Private file storage is unavailable.',503); return env.BUCKET; }
async function ensureAccountActive(user:Identity){
  const row=await db().prepare("SELECT 1 AS deleting FROM cyber_workspaces WHERE owner_id=? AND json_extract(payload,'$.__deleting')=1").bind(user.userId).first();
  if(row)throw new DomainError('Your CyberApply account deletion is in progress. Open Account to retry cleanup.',409);
}
export async function accountStatus(user:Identity){
  const row=await db().prepare('SELECT revision,payload FROM cyber_workspaces WHERE owner_id=?').bind(user.userId).first<{revision:number;payload:string}>();
  if(!row)return {revision:0,deleting:false,files:0,jobs:0,applications:0};
  const stored=JSON.parse(row.payload);
  if(stored.__deleting===true)return {revision:row.revision,deleting:true,files:0,jobs:0,applications:0};
  const state=liveState(stored);
  return {revision:row.revision,deleting:false,files:state.attachments.length,jobs:state.jobs.length,applications:state.applications?.length||0};
}
export async function deleteAccount(user:Identity,expected:number){
  if(!Number.isSafeInteger(expected)||expected<0)throw new DomainError('Reload your account before deleting it.',400);
  let current=await accountStatus(user);
  if(!current.deleting&&current.revision===0){await load(user);current=await accountStatus(user);}
  if(!current.deleting){
    if(current.revision!==expected)throw new DomainError('Your workspace changed. Reload your account before deleting it.',409);
    // A marker blocks reads and writes while cleanup runs and lets the owner retry an interrupted deletion.
    const marker=JSON.stringify({__deleting:true});
    const now=new Date().toISOString();
    const result=await db().prepare("UPDATE cyber_workspaces SET payload=?,revision=revision+1,write_token=?,updated_at=? WHERE owner_id=? AND revision=? AND json_extract(payload,'$.__deleting') IS NULL").bind(marker,crypto.randomUUID(),now,user.userId,expected).run();
    if(result.meta.changes!==1)throw new DomainError('Your workspace changed. Reload your account before deleting it.',409);
  }
  const prefix=`owners/${encodeURIComponent(user.userId)}/`;
  try{
    while(true){
      const page=await files().list({prefix,limit:1000});
      const keys=page.objects.map(object=>object.key);
      if(!keys.length)break;
      await files().delete(keys);
    }
  }catch{
    throw new DomainError('Account deletion is paused while private CV storage is unavailable. Your workspace is locked. Return to Account and retry deletion.',503);
  }
  try{
    await db().batch([
      db().prepare('DELETE FROM cyber_ai_usage WHERE owner_id=?').bind(user.userId),
      db().prepare('DELETE FROM cyber_career_versions WHERE owner_id=?').bind(user.userId),
      db().prepare('DELETE FROM cyber_career_records WHERE owner_id=?').bind(user.userId),
      db().prepare('DELETE FROM cyber_career_usage WHERE owner_id=?').bind(user.userId),
      db().prepare('DELETE FROM cyber_agent_presence WHERE owner_id=?').bind(user.userId),
      db().prepare('DELETE FROM cyber_receipt_checks WHERE owner_id=?').bind(user.userId),
    db().prepare('DELETE FROM cyber_revisions WHERE owner_id=?').bind(user.userId),
      db().prepare("DELETE FROM cyber_workspaces WHERE owner_id=? AND json_extract(payload,'$.__deleting')=1").bind(user.userId),
    ]);
  }catch{
    throw new DomainError('Account deletion is paused while workspace storage is unavailable. Your workspace is locked. Return to Account and retry deletion.',503);
  }
  return {deleted:true};
}
export function ownedFile(state: State, id: string): Attachment { const file = state.attachments.find(item=>item.id===id); if(!file) throw new DomainError('File not found in your workspace.',404); return file; }
export function response(value: unknown, status = 200) { return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
export function failure(error: unknown) { if(error instanceof SearchCooldownError){const result=response({error:error.message,searchCooldown:error.cooldown},429);result.headers.set('Retry-After',String(Math.ceil(error.cooldown.remainingMs/1000)));return result;} if(error instanceof DomainError) return response({error:error.message},error.status); console.error('CyberApply request failed',error instanceof Error?error.name:'unknown'); return response({error:'The operation could not be completed. Your saved work has been retained.'},500); }
