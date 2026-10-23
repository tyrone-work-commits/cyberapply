import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { actionSchema, emptyState, liveState, DomainError, reduceAction, type State, type Activity, type Attachment } from './cyber-domain';
import { discover, mergeDiscovery } from './job-discovery';
import { defaultSearch } from './job-catalog';
import { liveSearchCooldown, type SearchCooldown } from './search-cooldown';

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
  const state=liveState(stored);
  return {revision:row.revision, updatedAt:row.updated_at, state, searchCooldown:liveSearchCooldown(state.discovery?.lastSearch.at)};
}
export async function save(user: Identity, expected: number, state: State, action: string): Promise<Snapshot> {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new DomainError('A current workspace revision is required.');
  const revision = expected + 1, at = new Date().toISOString(), token = crypto.randomUUID(), payload = JSON.stringify(state);
  if (payload.length > 750000) throw new DomainError('Workspace record limit reached. Export your work before continuing.', 413);
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
  const current = await load(user);
  if (current.revision !== expected) throw new DomainError('Your workspace changed. Reload before saving.', 409);
  const result = reduceAction(current.state, parsed.data, source);
  return {...await save(user, expected, result.state, parsed.data.type),message:result.message};
}
export async function discoverJobs(user:Identity,expected:number,settings:unknown,source:Activity['source']) {
  if(!Number.isSafeInteger(expected)||expected<0)throw new DomainError('A current numeric workspace revision is required.');
  const current=await load(user);
  if(current.revision!==expected)throw new DomainError('Your workspace changed. Reload before searching.',409);
  if(current.searchCooldown.remainingMs>0)throw new SearchCooldownError(current.searchCooldown);
  const result=await discover(settings??current.state.discovery?.settings??defaultSearch);
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
