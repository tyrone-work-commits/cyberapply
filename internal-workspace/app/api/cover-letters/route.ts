import {z} from 'zod';
import {identity,load,files,ownedFile,response,failure,save} from '@/lib/cyber-store';
import {DomainError,record as activity} from '@/lib/cyber-domain';
import {createCareer,getCareer,listCareer,updateCareer,deleteCareer,privateJson} from '@/lib/career-store';
import {letterInput,basicLetter,letterDocument,attachmentIssue,type CoverLetter} from '@/lib/cover-letters';
import {writeText} from '@/lib/ai-server';
import {AiError} from '@/lib/ai-service';
import {unsupportedRewrite} from '@/lib/optimize';
import {extractResume} from '@/lib/resume-extraction';
import {resumeDocx} from '@/lib/resume-renderer';
import type {ScanData} from '@/lib/scans';
export const dynamic='force-dynamic';
const id=z.string().min(1).max(100),version=z.number().int().positive();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('generate'),input:letterInput}).strict(),
 z.object({action:z.literal('rewrite'),id,version,tone:letterInput.shape.tone,length:letterInput.shape.length,focus:letterInput.shape.focus}).strict(),
 z.object({action:z.literal('attach'),id,version,applicationId:id,confirmation:z.literal('ATTACH_REVIEWED_LETTER')}).strict(),
]);
function fail(e:unknown){if(e instanceof z.ZodError)return response({error:'Check the letter fields and current saved version.'},400);if(e instanceof AiError)return response({error:e.message},e.status);return failure(e instanceof DomainError?e:new DomainError(e instanceof Error?e.message:'Could not update the letter.'));}
async function generate(user:Awaited<ReturnType<typeof identity>>,input:z.infer<typeof letterInput>){const fallback=basicLetter(input),draft=await writeText(user,{task:'cover_letter',system:'Write a factual cover letter from the CV evidence. The company and title are the target, not claims of previous employment. Do not invent experience, numbers, qualifications or company problems. Return only the letter; do not certify non-AI authorship.',prompt:JSON.stringify({cv:input.resumeText,role:input.jobTitle,company:input.company,description:input.jobDescription,style:input.style,tone:input.tone,length:input.length,focus:input.focus}).slice(0,28000),fallback:()=>fallback});return unsupportedRewrite(input.resumeText+'\n'+fallback,draft)?fallback:draft;}
export async function GET(request:Request){try{const user=await identity(request);await load(user);const q=new URL(request.url).searchParams;return response(q.get('id')?{record:await getCareer<CoverLetter>(user,'coverLetters',q.get('id')!)}:{items:await listCareer<CoverLetter>(user,'coverLetters',{limit:100})});}catch(e){return fail(e);}}
async function letterBody(request:Request){if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))return privateJson(request);const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);if(Number(request.headers.get('content-length')||0)>6_000_000)throw new DomainError('Choose a file below 5 MB.',413);const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>5_000_000)throw new DomainError('Choose a PDF, DOCX or TXT below 5 MB.');let data;try{data=letterInput.parse(JSON.parse(String(form.get('input'))));}catch{throw new DomainError('Check the cover letter fields.');}data.resumeText=(await extractResume(new Uint8Array(await file.arrayBuffer()),file.name)).text;delete data.resumeId;return {action:'generate',input:data};}
export async function POST(request:Request){let cleanup:string|undefined;try{const user=await identity(request),current=await load(user),body=schema.parse(await letterBody(request));
 if(body.action==='generate'){const input=body.input;if(input.scanId){const scan=await getCareer<ScanData>(user,'scans',input.scanId);input.resumeText=scan.data.resumeText;input.jobDescription=scan.data.jobDescription;}
  if(input.resumeId){const file=ownedFile(current.state,input.resumeId),object=await files().get(file.key);if(!object)throw new DomainError('The selected CV is unavailable.',404);input.resumeText=(await extractResume(new Uint8Array(await object.arrayBuffer()),file.name)).text;}
  if(input.resumeText.trim().length<20)throw new DomainError('Choose a saved CV or paste its text.');if((await listCareer(user,'coverLetters',{limit:100})).length>=100)throw new DomainError('Keep up to 100 letters; remove an unneeded draft first.',409);
  const letter:CoverLetter={...input,name:[input.company,input.jobTitle].join(' — '),body:await generate(user,input),archived:false,generatedAt:new Date().toISOString()};return response({record:await createCareer(user,'coverLetters',letter)},201);
 }
 const record=await getCareer<CoverLetter>(user,'coverLetters',body.id);if(record.version!==body.version)throw new DomainError('This letter changed in another tab. Reload before continuing.',409);
 if(body.action==='rewrite'){const next={...record.data,tone:body.tone,length:body.length,focus:body.focus};next.body=await generate(user,next);return response({record:await updateCareer(user,record,body.version,next)});}
 const issue=attachmentIssue(current.state,record.data,body.applicationId);if(issue)throw new DomainError(issue,409);const application=current.state.applications!.find(a=>a.id===body.applicationId)!;

 const bytes=resumeDocx(letterDocument(record.data)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''),key=`owners/${encodeURIComponent(user.userId)}/career/application-letter-${crypto.randomUUID()}`;cleanup=key;await files().put(key,bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}});
 application.coverLetter={letterId:record.id,version:record.version,text:record.data.body,key,name:'cover-letter.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sha256:digest};application.status='needs_action';delete application.agentAuthorizedAt;application.result={at:new Date().toISOString(),message:'Your reviewed cover letter is attached. Queue this application when you are ready.'};const draft=current.state.drafts.find(d=>d.id===application.draftId);if(draft){draft.text=record.data.body;draft.version++;draft.updatedAt=new Date().toISOString();draft.status='ready';application.draftVersion=draft.version;application.text=draft.text;}
 activity(current.state,'attach_cover_letter','Attached a reviewed cover letter to an unsent application. It was not queued or submitted.','interface');await save(user,current.revision,current.state,'attach_cover_letter');cleanup=undefined;return response({attached:true,message:'Reviewed letter attached. The application has not been queued or submitted.'});
 }catch(e){if(cleanup)try{await files().delete(cleanup);}catch{}return fail(e);}}
export async function PATCH(request:Request){try{const user=await identity(request);await load(user);const body=z.object({id,version,name:z.string().trim().min(1).max(400),body:z.string().trim().min(20).max(12000)}).strict().parse(await privateJson(request)),record=await getCareer<CoverLetter>(user,'coverLetters',body.id);return response({record:await updateCareer(user,record,body.version,{...record.data,name:body.name,body:body.body})});}catch(e){return fail(e);}}
export async function DELETE(request:Request){try{const user=await identity(request);await load(user);const body=z.object({id,version}).strict().parse(await privateJson(request));return response(await deleteCareer(user,'coverLetters',body.id,body.version));}catch(e){return fail(e);}}
