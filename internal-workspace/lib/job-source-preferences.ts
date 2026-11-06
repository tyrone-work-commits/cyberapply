import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {DomainError} from './cyber-domain';
import type {Identity} from './cyber-store';
import {getCareer,listCareer,type CareerRecord} from './career-store';
import {boardSchema,boardKey,searchSchema,type EmployerBoard,type JobSearch} from './job-catalog';
import type {SavedSource} from './saved-job-sources';

export const sourceBoardsSchema=z.array(boardSchema).max(10).superRefine((boards,ctx)=>{if(new Set(boards.map(boardKey)).size!==boards.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Choose each employer board once.'});if(boards.some(b=>b.provider!=='lever'&&b.region==='eu'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Only Lever has an EU endpoint.'});});
export type SourcePreferences={boards:EmployerBoard[];archived:false};
const db=()=>{if(!env.DB)throw new DomainError('Source settings storage is unavailable.',503);return env.DB;};
export async function sourcePreferences(user:Identity){try{return await getCareer<SourcePreferences>(user,'sourcePreferences','primary');}catch(e){if(e instanceof DomainError&&e.status===404)return null;throw e;}}
export function profileSourceSearch(settings:JobSearch,preferences:SourcePreferences|null):JobSearch{return preferences?{...settings,boards:preferences.boards}:settings;}
export async function sourceSettings(user:Identity,fallback:JobSearch){const configuration=await sourcePreferences(user);return{configuration,settings:profileSourceSearch(fallback,configuration?.data||null)};}
export async function configuredSearch(user:Identity,input:unknown,fallback:JobSearch){const configuration=await sourcePreferences(user);if(configuration&&!configuration.data.boards.length)throw new DomainError('Choose at least one employer board in Edit Profile before searching.');const raw=input??fallback;const parsed=searchSchema.safeParse(configuration?{...(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}),boards:configuration.data.boards}:raw);if(!parsed.success)throw new DomainError('Check the job search settings.');return parsed.data;}

// Configuration and background-source changes share one guarded transaction.
// A refreshing/stale row cannot be silently overwritten by a profile save.
export async function saveSourcePreferences(user:Identity,expected:number,input:unknown,remove?:{id:string;version:number}){
 const boards=sourceBoardsSchema.parse(input),old=await sourcePreferences(user);
 if((old?.version||0)!==expected)throw new DomainError('Your employer boards changed in another tab. Reload sources before saving.',409);
 const rows=await listCareer<SavedSource>(user,'jobSources',{limit:100}),at=new Date().toISOString();
 if(rows.some(r=>r.data.lease&&Date.parse(r.data.lease.until)>Date.now()))throw new DomainError('A saved source is refreshing. Wait for it to finish before changing employer boards.',409);
 if(remove&&!rows.some(r=>r.id===remove.id&&r.version===remove.version))throw new DomainError('The saved source changed. Reload before removing it.',409);
 const token=crypto.randomUUID(),data:SourcePreferences={boards,archived:false};
 const guards=["(SELECT count(*) FROM cyber_career_records WHERE owner_id=? AND kind='jobSources' AND coalesce(json_extract(payload,'$.archived'),0)=0)=?"];
 const args:unknown[]=[user.userId,rows.length];
 for(const row of rows){guards.push("EXISTS(SELECT 1 FROM cyber_career_records WHERE owner_id=? AND kind='jobSources' AND id=? AND version=?)");args.push(user.userId,row.id,row.version);}
 const allowed="EXISTS(SELECT 1 FROM cyber_career_records WHERE owner_id=? AND kind='sourcePreferences' AND id='primary' AND write_token=?)";
 const statements=[db().prepare(`INSERT INTO cyber_career_records(owner_id,kind,id,version,payload,write_token,created_at,updated_at) SELECT ?,'sourcePreferences','primary',1,?,?,?,? WHERE ${guards.join(' AND ')} ON CONFLICT(owner_id,kind,id) DO UPDATE SET payload=excluded.payload,version=cyber_career_records.version+1,write_token=excluded.write_token,updated_at=excluded.updated_at WHERE cyber_career_records.version=?`).bind(user.userId,JSON.stringify(data),token,at,at,...args,expected)];
 if(old)statements.push(db().prepare(`INSERT OR IGNORE INTO cyber_career_versions(owner_id,kind,id,version,payload,created_at) SELECT ?,'sourcePreferences','primary',?,?,? WHERE ${allowed}`).bind(user.userId,old.version,JSON.stringify(old.data),at,user.userId,token));
 for(const row of rows){
  if(remove?.id===row.id){statements.push(db().prepare(`DELETE FROM cyber_career_versions WHERE owner_id=? AND kind='jobSources' AND id=? AND ${allowed}`).bind(user.userId,row.id,user.userId,token));statements.push(db().prepare(`DELETE FROM cyber_career_records WHERE owner_id=? AND kind='jobSources' AND id=? AND version=? AND ${allowed}`).bind(user.userId,row.id,row.version,user.userId,token));continue;}
  const selected=boards.find(b=>boardKey(b)===row.data.key),next={...row.data,...(selected?{board:selected,settings:{...row.data.settings,boards:[selected]}}:{enabled:false})};
  if(JSON.stringify(next)===JSON.stringify(row.data))continue;
  statements.push(db().prepare(`UPDATE cyber_career_records SET payload=?,version=version+1,write_token=?,updated_at=? WHERE owner_id=? AND kind='jobSources' AND id=? AND version=? AND ${allowed}`).bind(JSON.stringify(next),token,at,user.userId,row.id,row.version,user.userId,token));
  statements.push(db().prepare(`INSERT OR IGNORE INTO cyber_career_versions(owner_id,kind,id,version,payload,created_at) SELECT ?,'jobSources',?,?,?,? WHERE ${allowed}`).bind(user.userId,row.id,row.version,JSON.stringify(row.data),at,user.userId,token));
  statements.push(db().prepare(`DELETE FROM cyber_career_versions WHERE owner_id=? AND kind='jobSources' AND id=? AND version<? AND ${allowed}`).bind(user.userId,row.id,Math.max(0,row.version-18),user.userId,token));
 }
 statements.push(db().prepare(`DELETE FROM cyber_career_versions WHERE owner_id=? AND kind='sourcePreferences' AND id='primary' AND version<? AND ${allowed}`).bind(user.userId,Math.max(0,expected-18),user.userId,token));
 const results=await db().batch(statements);if(results[0].meta.changes!==1)throw new DomainError('Source settings changed while saving. Reload sources before trying again.',409);
 return getCareer<SourcePreferences>(user,'sourcePreferences','primary');
}
export async function removeProfileSource(user:Identity,id:string,version:number,fallback:JobSearch){const row=await getCareer<SavedSource>(user,'jobSources',id);if(row.version!==version)throw new DomainError('Source settings changed. Reload before removing.',409);const {configuration,settings}=await sourceSettings(user,fallback);const saved=await saveSourcePreferences(user,configuration?.version||0,settings.boards.filter(board=>boardKey(board)!==row.data.key),{id,version});return{deleted:true,configuration:saved};}
