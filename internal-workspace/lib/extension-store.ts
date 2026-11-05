import {env} from 'cloudflare:workers';
import {DomainError} from './cyber-domain';
import {load,files,ownedFile,type Identity} from './cyber-store';
import {createCareer,getCareer,updateCareer,listCareer,remainingCareer} from './career-store';
import {extensionHash,equalExtensionHash,extensionGrantAllows,extensionIdPattern,type ExtensionGrant,type ExtensionImport} from './extension-protocol';
import {blankTracker,type TrackerItem} from './tracker';
import {extractResume} from './resume-extraction';
import {inspectResumeFormatting} from './resume-formatting';
import {scanResume} from './scan-engine';
import type {ScanData} from './scans';
const db=()=>{if(!env.DB)throw new DomainError('Extension storage unavailable.',503);return env.DB;};
export function extensionScanLimit(){const n=Number((env as unknown as Record<string,unknown>).SCAN_MONTHLY_LIMIT||5);return Number.isSafeInteger(n)&&n>0&&n<=1000?n:5;}
export async function extensionAuth(request:Request,scope:string){
 const id=request.headers.get('x-cyberapply-extension-id')||'',origin=request.headers.get('origin');
 if(!extensionIdPattern.test(id)||(origin&&origin!==`chrome-extension://${id}`))throw new DomainError('This extension origin is not allowed.',403);
 const match=request.headers.get('authorization')?.match(/^Bearer (ca_ext\.([a-f0-9-]{36})\.[a-f0-9]{64})$/);if(!match)throw new DomainError('Connect a scoped extension token in Settings.',401);
 const row=await db().prepare("SELECT owner_id,payload FROM cyber_career_records WHERE kind='extensionTokens' AND id=? LIMIT 2").bind(match[2]).all<{owner_id:string;payload:string}>();
 if(row.results.length!==1)throw new DomainError('Extension token unavailable or revoked.',401);
 const grant=JSON.parse(row.results[0].payload) as ExtensionGrant;
 if(!extensionGrantAllows(grant,id,scope)||!equalExtensionHash(grant.hash,await extensionHash(match[1])))throw new DomainError('Extension token expired, revoked or missing this permission.',403);
 const user={userId:row.results[0].owner_id,email:'',displayName:''};await load(user);return {user,extensionId:id};
}
export async function extensionPreflight(request:Request){const origin=request.headers.get('origin')||'',id=origin.replace('chrome-extension://','');if(origin!==`chrome-extension://${id}`||!extensionIdPattern.test(id))throw new DomainError('Extension origin not allowed.',403);const rows=await db().prepare("SELECT payload FROM cyber_career_records WHERE kind='extensionTokens' AND json_extract(payload,'$.extensionId')=? LIMIT 100").bind(id).all<{payload:string}>();if(!rows.results.some(r=>extensionGrantAllows(JSON.parse(r.payload),id,'recent_jobs')))throw new DomainError('Register this extension in Settings first.',403);return new Response(null,{status:204,headers:extensionCors(id)});}
export function extensionCors(id:string){return {'Access-Control-Allow-Origin':`chrome-extension://${id}`,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-CyberApply-Extension-Id','Vary':'Origin','Cache-Control':'no-store'};}
export async function readExtensionJson(request:Request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);const text=await request.text();if(text.length>40000)throw new DomainError('Job description too large.',413);try{return JSON.parse(text);}catch{throw new DomainError('Invalid JSON.');}}
// The reservation row and usage increment share a D1 transaction. A retry of the
// same transfer cannot consume a second scan, even after a worker interruption.
export async function reserveExtensionScan(user:Identity,id:string){const period=new Date().toISOString().slice(0,7),at=new Date().toISOString(),token=crypto.randomUUID();await db().batch([
 db().prepare('INSERT OR IGNORE INTO cyber_career_usage(owner_id,kind,period,count) VALUES (?,\'scans\',?,0)').bind(user.userId,period),
 db().prepare("INSERT INTO cyber_career_records(owner_id,kind,id,version,payload,write_token,created_at,updated_at) SELECT ?,'scanReservations',?,1,?,?,?,? WHERE (SELECT count FROM cyber_career_usage WHERE owner_id=? AND kind='scans' AND period=?)<? ON CONFLICT(owner_id,kind,id) DO NOTHING").bind(user.userId,id,JSON.stringify({period}),token,at,at,user.userId,period,extensionScanLimit()),
 db().prepare("UPDATE cyber_career_usage SET count=count+1 WHERE owner_id=? AND kind='scans' AND period=? AND EXISTS(SELECT 1 FROM cyber_career_records WHERE owner_id=? AND kind='scanReservations' AND id=? AND write_token=?)").bind(user.userId,period,user.userId,id,token),
 ]);try{await getCareer(user,'scanReservations',id);}catch{throw new DomainError('Your monthly scan limit is used up. The job is still saved.',429);}}
type ImportResult={trackerId:string;scanId?:string;score?:number;url:string;remaining:number};
type ImportRecord={fingerprint:string;job:ExtensionImport;result?:ImportResult;workingAt?:string};
export async function importExtensionJob(user:Identity,input:ExtensionImport):Promise<ImportResult>{
 const current=await load(user),fingerprint=await extensionHash(JSON.stringify(input));let transfer;
 try{transfer=await getCareer<ImportRecord>(user,'extensionImports',input.transferId);}catch(e){if(!(e instanceof DomainError&&e.status===404))throw e;try{transfer=await createCareer(user,'extensionImports',{fingerprint,job:input} as ImportRecord,input.transferId);}catch{transfer=await getCareer<ImportRecord>(user,'extensionImports',input.transferId);}}
 if(transfer.data.fingerprint!==fingerprint)throw new DomainError('This transfer ID was already used for different job details.',409);
 if(transfer.data.result)return {...transfer.data.result,remaining:await remainingCareer(user,'scans',extensionScanLimit())};
 if(transfer.data.workingAt&&Date.now()-Date.parse(transfer.data.workingAt)<120000)throw new DomainError('This transfer is still being processed. Wait a moment before checking again.',409);
 transfer=await updateCareer(user,transfer,transfer.version,{...transfer.data,workingAt:new Date().toISOString()});
 try{const trackerId='extension-'+(await extensionHash(input.url)).slice(0,40);try{await getCareer(user,'tracker',trackerId);}catch(e){if(!(e instanceof DomainError&&e.status===404))throw e;const data:TrackerItem={...blankTracker(),title:input.title,company:input.company,location:input.location,url:input.url,description:input.description,sourceStatus:'Saved from your visible job page; no application sent',timeline:[{at:new Date().toISOString(),message:'Saved from browser extension. No employer form was accessed.'}]};try{await createCareer(user,'tracker',data,trackerId);}catch{await getCareer(user,'tracker',trackerId);}}
 let scanId:string|undefined,score:number|undefined;if(input.mode==='scan'){
  scanId='extension-scan-'+input.transferId;let existing;try{existing=await getCareer<ScanData>(user,'scans',scanId);}catch(e){if(!(e instanceof DomainError&&e.status===404))throw e;}
  if(existing)score=existing.data.report.score;else{
   if(!current.state.selectedCvId)throw new DomainError('Choose your main CV in CyberApply before scanning. The job is saved.',409);const file=ownedFile(current.state,current.state.selectedCvId),object=await files().get(file.key);if(!object)throw new DomainError('The chosen CV is unavailable. The job is saved.',409);
   const bytes=new Uint8Array(await object.arrayBuffer()),extracted=await extractResume(bytes,file.name);let formatting;try{formatting=await inspectResumeFormatting(bytes,file.name);}catch{formatting={note:'Text read; review the original CV for layout.'};}
   const excluded=await listCareer<{skill:string}>(user,'excludedSkills',{limit:100});const data:ScanData={resumeText:extracted.text,resumeId:file.id,fileName:file.name,fileKind:extracted.format.toLowerCase(),jobTitle:input.title,company:input.company,jobDescription:input.description,jobUrl:input.url,formatting,excludedSkills:excluded.map(r=>r.data.skill),title:input.company+' — '+input.title,status:'saved',archived:false,trackerId,report:scanResume({resumeText:extracted.text,jobDescription:input.description,jobTitle:input.title,jobUrl:input.url,formatting,excludedSkills:excluded.map(r=>r.data.skill)})};
   await reserveExtensionScan(user,input.transferId);try{await createCareer(user,'scans',data,scanId);score=data.report.score;}catch(e){const saved=await getCareer<ScanData>(user,'scans',scanId);score=saved.data.report.score;}
  }
 }
 const result:ImportResult={trackerId,scanId,score,url:scanId?'/workspace?view=scan:'+encodeURIComponent(scanId):'/workspace?view=tracker&item='+trackerId,remaining:await remainingCareer(user,'scans',extensionScanLimit())};await updateCareer(user,transfer,transfer.version,{...transfer.data,workingAt:undefined,result});return result;
 }catch(e){try{await updateCareer(user,transfer,transfer.version,{...transfer.data,workingAt:undefined});}catch{}throw e;}
}
