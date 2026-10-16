import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { actionSchema, emptyState, demoState, DomainError, reduceAction, type State, type Activity, type Attachment } from './cyber-domain';

export type Identity = { userId: string; email: string; displayName: string; demo?: boolean };
export type Snapshot = { revision: number; updatedAt: string; state: State };
function db() { if (!env.DB) throw new DomainError('Workspace storage is unavailable.', 503); return env.DB; }
export function workspaceIdentity(user: Identity, mode: unknown): Identity {
  if (mode !== undefined && mode !== null && mode !== 'demo' && mode !== 'personal') throw new DomainError('Choose demo or personal workspace.');
  return mode === 'demo' ? {...user,userId:`demo/v1/${user.userId}`,demo:true} : user;
}
export async function identity(request?: Request): Promise<Identity> { const user = await getChatGPTUser(); if (!user) throw new DomainError('Sign in with ChatGPT to access your private workspace.', 401); return workspaceIdentity(user,request?new URL(request.url).searchParams.get('mode'):undefined); }
export async function load(user: Identity): Promise<Snapshot> {
  const now = new Date().toISOString();
  await db().prepare('INSERT OR IGNORE INTO cyber_workspaces (owner_id,revision,payload,write_token,updated_at) VALUES (?,0,?,?,?)').bind(user.userId, JSON.stringify(user.demo?demoState(now):emptyState(user.email)), crypto.randomUUID(), now).run();
  const row = await db().prepare('SELECT revision,payload,updated_at FROM cyber_workspaces WHERE owner_id=?').bind(user.userId).first<{revision:number;payload:string;updated_at:string}>();
  if (!row) throw new DomainError('Workspace could not be loaded.', 503);
  return {revision:row.revision, updatedAt:row.updated_at, state:JSON.parse(row.payload)};
}
export async function save(user: Identity, expected: number, state: State, action: string): Promise<Snapshot> {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new DomainError('A current workspace revision is required.');
  const revision = expected + 1, at = new Date().toISOString(), token = crypto.randomUUID(), payload = JSON.stringify(state);
  if (payload.length > 750000) throw new DomainError('Workspace record limit reached. Export your work before continuing.', 413);
  const results = await db().batch([
    db().prepare('UPDATE cyber_workspaces SET payload=?,revision=?,write_token=?,updated_at=? WHERE owner_id=? AND revision=?').bind(payload,revision,token,at,user.userId,expected),
    db().prepare('INSERT INTO cyber_revisions (owner_id,revision,payload,action,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM cyber_workspaces WHERE owner_id=? AND write_token=?)').bind(user.userId,revision,payload,action,at,user.userId,token),
  ]);
  if (results[0].meta.changes !== 1) throw new DomainError('Your workspace changed in another window or tool. Reload before trying again; your previous work is safe.', 409);
  return {revision,updatedAt:at,state};
}
export async function act(user: Identity, expected: number, input: unknown, source: Activity['source']) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const current = await load(user);
  if (current.revision !== expected) throw new DomainError('Your workspace changed. Reload before saving.', 409);
  const result = reduceAction(current.state, parsed.data, source);
  return {...await save(user, expected, result.state, parsed.data.type),message:result.message};
}
export async function history(user: Identity, before = 2147483647) {
  const rows = await db().prepare('SELECT revision,action,created_at FROM cyber_revisions WHERE owner_id=? AND revision<? ORDER BY revision DESC LIMIT 30').bind(user.userId,before).all();
  return rows.results;
}
export async function revision(user: Identity, number: number) {
  const row = await db().prepare('SELECT revision,payload,action,created_at FROM cyber_revisions WHERE owner_id=? AND revision=?').bind(user.userId,number).first<{revision:number;payload:string;action:string;created_at:string}>();
  if (!row) throw new DomainError('That saved version is not in your workspace.',404);
  return {revision:row.revision,state:JSON.parse(row.payload) as State,action:row.action,at:row.created_at};
}
export function files() { if (!env.BUCKET) throw new DomainError('Private file storage is unavailable.',503); return env.BUCKET; }
export function ownedFile(state: State, id: string): Attachment { const file = state.attachments.find(item=>item.id===id); if(!file) throw new DomainError('File not found in your workspace.',404); return file; }
export function response(value: unknown, status = 200) { return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
export function failure(error: unknown) { if(error instanceof DomainError) return response({error:error.message},error.status); console.error('CyberApply request failed',error instanceof Error?error.name:'unknown'); return response({error:'The operation could not be completed. Your saved work has been retained.'},500); }
