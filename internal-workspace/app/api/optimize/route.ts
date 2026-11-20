import {z} from 'zod';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {createCareer,getCareer,listCareer,updateCareer,deleteCareer,privateJson} from '@/lib/career-store';
import {writeJson,writeText} from '@/lib/ai-server';
import {AiError} from '@/lib/ai-service';
import {optimizeFrom,basicSuggestions,unsupportedRewrite,changeSuggestion,editOptimization,phraseIdeas,basicSummary,resumeText,type Optimization,type Suggestion} from '@/lib/optimize';
import {optimizationDocx,saveGeneratedCv} from '@/lib/generated-cv';
import type {ScanData} from '@/lib/scans';
export const dynamic='force-dynamic';
const id=z.string().min(1).max(100),version=z.number().int().positive();
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),scanId:id}).strict(),
 z.object({action:z.literal('suggest'),id,version}).strict(),
 z.object({action:z.literal('decision'),id,version,suggestionId:id,decision:z.enum(['accept','reject']),evidence:z.string().trim().max(4000).optional()}).strict(),
 z.object({action:z.literal('acceptAll'),id,version}).strict(),
 z.object({action:z.literal('saveVersion'),id,version,clean:z.boolean().default(false)}).strict(),
 z.object({action:z.literal('phrases'),skill:z.string().trim().min(1).max(100)}).strict(),
 z.object({action:z.literal('standaloneSummary'),targetTitle:z.string().trim().max(200),years:z.string().trim().max(200),skills:z.string().trim().max(1000),achievements:z.string().trim().min(10).max(5000)}).strict(),
 z.object({action:z.literal('summary'),resumeText:z.string().trim().min(20).max(25000),targetTitle:z.string().trim().max(200).default('')}).strict(),
]);
function fail(error:unknown){if(error instanceof z.ZodError)return response({error:'Check the optimization fields and reload the saved document if necessary.'},400);if(error instanceof AiError)return response({error:error.message},error.status);return failure(error instanceof DomainError?error:new DomainError(error instanceof Error?error.message:'This draft could not be updated.'));}
export async function GET(request:Request){try{const user=await identity(request);await load(user);const q=new URL(request.url).searchParams;return response(q.get('id')?{record:await getCareer<Optimization>(user,'optimize',q.get('id')!)}:{items:await listCareer<Optimization>(user,'optimize')});}catch(error){return fail(error);}}
export async function POST(request:Request){try{const user=await identity(request);await load(user);const body=input.parse(await privateJson(request));
 if(body.action==='create'){const scan=await getCareer<ScanData>(user,'scans',body.scanId);return response({record:await createCareer(user,'optimize',optimizeFrom(scan.id,scan.data))},201);}
 if(body.action==='phrases'){return response({phrases:phraseIdeas(body.skill),draft:true,requiresEvidence:true});}
 if(body.action==='standaloneSummary'){const evidence=[body.years?body.years+' years of relevant experience.':'',body.skills?'Skills: '+body.skills+'.':'',body.achievements].filter(Boolean).join(' '),fallback=(body.targetTitle?'Target role: '+body.targetTitle+'. ':'')+evidence;const draft=await writeText(user,{task:'cv_summary',system:'Write a concise professional summary from only the supplied evidence. Target title is an aspiration, not a held job. Do not invent claims.',prompt:fallback,fallback:()=>fallback});return response({summary:unsupportedRewrite(fallback,draft)?fallback:draft,draft:true});}
 if(body.action==='summary'){const fallback=basicSummary(body.resumeText,body.targetTitle);if(!fallback)throw new DomainError('Add real work evidence to the CV before generating a summary.');const summary=await writeText(user,{task:'cv_summary',system:'Rephrase only the supplied work evidence. Do not add claims. Preserve any target-role label as an aspiration, not a held job.',prompt:body.resumeText+'\nTarget role: '+body.targetTitle,fallback:()=>fallback});const evidence=body.resumeText+'\nTarget role: '+body.targetTitle;const issue=unsupportedRewrite(evidence,summary);return response({summary:issue?fallback:summary,draft:true,note:issue||'Review this draft before adding it to your CV.'});}
 const record=await getCareer<Optimization>(user,'optimize',body.id);if(record.version!==body.version)throw new DomainError('This editor changed in another tab. Reload before saving.',409);let next=structuredClone(record.data);
 if(body.action==='suggest'){
  const basic=basicSuggestions(next),supported=basic.filter(s=>!s.requiresEvidence);const schema=z.object({changes:z.array(z.object({blockId:z.string(),after:z.string().max(4000),reason:z.string().max(500)}).strict()).max(20)}).strict();
  const result=await writeJson(user,{task:'cv_optimization',system:'Return JSON {changes:[{blockId,after,reason}]}. Rephrase supplied paragraphs using their own evidence only; preserve every factual claim. Do not add missing skills. Empty changes are allowed.',prompt:JSON.stringify({blocks:next.blocks.map(b=>({id:b.id,text:b.text})),jobTitle:next.source.jobTitle}).slice(0,28000),fallback:()=>JSON.stringify({changes:supported.map(s=>({blockId:s.blockId,after:s.after,reason:s.reason}))})},schema);
  const changes:Suggestion[]=result.changes.flatMap(s=>{const block=next.blocks.find(b=>b.id===s.blockId);if(!block||unsupportedRewrite(block.text,s.after)||s.after===block.text)return [];return[{id:crypto.randomUUID(),blockId:block.id,before:block.text,after:s.after,reason:s.reason,skillsAdded:[],requiresEvidence:false,status:'pending'}];});next.suggestions=[...changes,...basic.filter(s=>s.requiresEvidence)];
 }else if(body.action==='decision')next=changeSuggestion(next,body.suggestionId,body.decision,body.evidence);
 else if(body.action==='acceptAll'){for(const suggestion of [...next.suggestions])if(!suggestion.requiresEvidence&&suggestion.status==='pending')next=changeSuggestion(next,suggestion.id,'accept');}
 else if(body.action==='saveVersion'){
  const bytes=await optimizationDocx(user,next,body.clean);const file=await saveGeneratedCv(user,bytes,`optimized-${record.id.slice(0,8)}-v${record.version}.docx`);return response({file,message:'Saved to your CV library. Review and choose it explicitly before using it for applications.'});
 }
 return response({record:await updateCareer(user,record,body.version,next)});
 }catch(error){return fail(error);}}
const edit=z.object({id,version,name:z.string().trim().min(1).max(200).optional(),blocks:z.array(z.object({id:z.string().min(1).max(100),text:z.string().max(4000)}).strict()).min(1).max(500).optional()}).strict();
export async function PATCH(request:Request){try{const user=await identity(request);await load(user);const body=edit.parse(await privateJson(request)),record=await getCareer<Optimization>(user,'optimize',body.id);let next=structuredClone(record.data);if(body.blocks){const known=new Map(next.blocks.map(b=>[b.id,b]));if(body.blocks.some(b=>!known.has(b.id)))throw new DomainError('An unknown paragraph was supplied. Reload before saving.');next=editOptimization(next,body.blocks.map(b=>({...known.get(b.id)!,text:b.text})));}if(body.name)next.name=body.name;return response({record:await updateCareer(user,record,body.version,next)});}catch(error){return fail(error);}}
export async function DELETE(request:Request){try{const user=await identity(request);await load(user);const body=z.object({id,version}).strict().parse(await privateJson(request));return response(await deleteCareer(user,'optimize',body.id,body.version));}catch(error){return fail(error);}}
