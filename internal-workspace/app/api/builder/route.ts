import {z} from 'zod';
import {identity,load,ownedFile,files,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {createCareer,getCareer,listCareer,updateCareer,deleteCareer,privateJson,careerVersions} from '@/lib/career-store';
import {builderSchema,blankResume,importResume,documentText,type ResumeDocument} from '@/lib/resume-builder';
import {resumePdf,resumeDocx} from '@/lib/resume-renderer';
import {saveGeneratedCv} from '@/lib/generated-cv';
import {extractResume} from '@/lib/resume-extraction';
import {writeText} from '@/lib/ai-server';
import {AiError} from '@/lib/ai-service';
import {unsupportedRewrite,basicSummary,phraseIdeas} from '@/lib/optimize';
import {scanResume} from '@/lib/scan-engine';
import {hardSkillAliases} from '@/lib/scan-taxonomy';
export const dynamic='force-dynamic';
const id=z.string().min(1).max(100),version=z.number().int().positive();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),source:z.enum(['blank','profile','resume','linkedin','paste']).default('blank'),resumeId:id.optional(),text:z.string().max(120000).optional()}).strict(),
 z.object({action:z.literal('duplicate'),id}).strict(),
 z.object({action:z.literal('restore'),id,version,restoreVersion:version}).strict(),
 z.object({action:z.literal('saveCv'),id,version,format:z.enum(['pdf','docx']).default('docx')}).strict(),
 z.object({action:z.literal('suggest'),kind:z.enum(['summary','bullets','skills','coach']),evidence:z.string().max(15000),title:z.string().max(200).default(''),skills:z.array(z.string().max(100)).max(2).default([])}).strict(),
]);
function fail(e:unknown){if(e instanceof z.ZodError)return response({error:e.issues.map(i=>i.message).join('; ')},400);if(e instanceof AiError)return response({error:e.message},e.status);return failure(e instanceof DomainError?e:new DomainError(e instanceof Error?e.message:'Could not update this résumé.'));}
export async function GET(request:Request){try{const user=await identity(request),current=await load(user),q=new URL(request.url).searchParams;if(!q.get('id'))return response({items:await listCareer<ResumeDocument>(user,'builder',{limit:100})});const record=await getCareer<ResumeDocument>(user,'builder',q.get('id')!);if(q.get('jobs')==='1'){const resumeText=documentText(record.data);return response({jobs:current.state.jobs.map(job=>({job,score:scanResume({resumeText,jobDescription:job.description,jobTitle:job.title}).score})).sort((a,b)=>b.score-a.score).slice(0,20)});}return response({record,versions:await careerVersions(user,'builder',record.id)});}catch(e){return fail(e);}}
export async function POST(request:Request){try{const user=await identity(request),current=await load(user);let raw:unknown;if(request.headers.get('content-type')?.startsWith('multipart/form-data')){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin uploads are not allowed.',403);if(Number(request.headers.get('content-length')||0)>6_000_000)throw new DomainError('Choose a file below 5 MB.',413);const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>5_000_000)throw new DomainError('Choose a PDF, DOCX or TXT file below 5 MB.');const extracted=await extractResume(new Uint8Array(await file.arrayBuffer()),file.name);raw={action:'create',source:'paste',text:extracted.text};}else raw=await privateJson(request);const body=schema.parse(raw);
 if(body.action==='suggest'){
  if(body.kind==='coach'&&!body.evidence.trim())return response({question:'Describe one real task you completed, the tool you used, and its outcome. Leave out confidential information.',text:''});
  if(body.kind==='skills'){const recommended=Object.keys(hardSkillAliases).filter(s=>(body.evidence+' '+body.title).toLowerCase().includes(s.toLowerCase())).slice(0,12);return response({text:recommended.length?recommended.join(', '):phraseIdeas(body.title||'your actual skill').join('\n'),draft:true,note:'Suggested skills must reflect your real experience.'});}
  if(!body.evidence.trim())throw new DomainError('Add your real experience before requesting wording suggestions.');const fallback=body.kind==='summary'?(basicSummary(body.evidence)||body.evidence):body.evidence.replace(/\bresponsible for\b/gi,'Worked on');const text=await writeText(user,{task:'resume_builder_'+body.kind,system:'Rephrase only the supplied evidence as concise résumé wording. Do not add tools, numbers, employers, qualifications or experience. Return only text.',prompt:body.evidence,fallback:()=>fallback});return response({text:unsupportedRewrite(body.evidence,text)?fallback:text,draft:true,question:body.kind==='coach'?'What specific outcome can you substantiate?':''});
 }
 if(body.action==='create'){
  if((await listCareer(user,'builder',{limit:21})).length>=20)throw new DomainError('Keep up to 20 résumé documents. Archive or delete an unneeded draft first.',409);let doc=blankResume();
  if(body.source==='profile'){const p=current.state.accountProfile;doc.profile={...doc.profile,name:p?.fullName||'',title:p?.headline||'',email:user.email,phone:p?.phone||'',location:[p?.city,p?.state,p?.country].filter(Boolean).join(', '),linkedIn:current.state.profile.linkedInUrl||'',website:current.state.profile.portfolioWebsiteUrl||''};doc.yearsExperience=p?.yearsExperience??null;doc.sections.find(s=>s.type==='skills')!.text=current.state.profile.skills.join(', ');}
  else if(body.source==='resume'){if(!body.resumeId)throw new DomainError('Choose a saved résumé.');const file=ownedFile(current.state,body.resumeId),object=await files().get(file.key);if(!object)throw new DomainError('The saved CV file is unavailable.',404);doc=importResume((await extractResume(new Uint8Array(await object.arrayBuffer()),file.name)).text);doc.name=file.name.replace(/\.[^.]+$/,'');}
  else if(body.source==='paste'||body.source==='linkedin'){if(!body.text?.trim())throw new DomainError('Paste the résumé or exported LinkedIn profile content. CyberApply does not scrape LinkedIn.');doc=importResume(body.text);}
  return response({record:await createCareer(user,'builder',builderSchema.parse(doc))},201);
 }
 const record=await getCareer<ResumeDocument>(user,'builder',body.id);
 if(body.action==='duplicate'){if((await listCareer(user,'builder',{limit:21})).length>=20)throw new DomainError('Keep up to 20 résumé documents. Delete an unneeded draft first.',409);return response({record:await createCareer(user,'builder',{...record.data,name:(record.data.name+' — copy').slice(0,300)})},201);}
 if(body.version!==record.version)throw new DomainError('The résumé changed. Reload before exporting or restoring.',409);
 if(body.action==='saveCv'){const bytes=body.format==='pdf'?await resumePdf(record.data):resumeDocx(record.data);return response({file:await saveGeneratedCv(user,bytes,`resume-${record.id.slice(0,8)}-v${record.version}.${body.format}`)});}
 const old=(await careerVersions(user,'builder',record.id)).find(v=>v.version===body.restoreVersion);if(!old)throw new DomainError('This version is no longer available.',404);return response({record:await updateCareer(user,record,body.version,builderSchema.parse(old.data))});
 }catch(e){return fail(e);}}
export async function PATCH(request:Request){try{const user=await identity(request);await load(user);const body=z.object({id,version,document:builderSchema}).strict().parse(await privateJson(request)),record=await getCareer<ResumeDocument>(user,'builder',body.id);return response({record:await updateCareer(user,record,body.version,body.document)});}catch(e){return fail(e);}}
export async function DELETE(request:Request){try{const user=await identity(request);await load(user);const body=z.object({id,version}).strict().parse(await privateJson(request));return response(await deleteCareer(user,'builder',body.id,body.version));}catch(e){return fail(e);}}
