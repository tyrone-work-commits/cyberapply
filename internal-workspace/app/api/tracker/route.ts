import {z} from 'zod';
import {identity,load,response,failure,ownedFile,files} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {createCareer,getCareer,updateCareer,privateJson} from '@/lib/career-store';
import {syncTracker} from '@/lib/tracker-store';
import {trackerSchema,blankTracker,applyTrackerEdit,basicThankYou,trackerReminders,type TrackerItem} from '@/lib/tracker';
import {writeText} from '@/lib/ai-server';
import {extractResume} from '@/lib/resume-extraction';
import {unsupportedRewrite} from '@/lib/optimize';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request),current=await load(user),items=await syncTracker(user,current.state);return response({items,reminders:trackerReminders(items),applications:current.state.applications||[]});}catch(e){return failure(e);}}
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),data:trackerSchema}).strict(),
 z.object({action:z.literal('save'),id:z.string().max(100),version:z.number().int(),data:trackerSchema}).strict(),
 z.object({action:z.literal('delete'),id:z.string().max(100),version:z.number().int(),confirmation:z.literal('DELETE_TRACKER_ITEM')}).strict(),
 z.object({action:z.literal('thank-you'),id:z.string().max(100),interviewId:z.string().max(100),template:z.enum(['short','detailed']),conversationPoint:z.string().trim().max(2000)}).strict(),
 z.object({action:z.literal('track-scan'),scanId:z.string().max(100)}).strict(),
]);
export async function POST(request:Request){try{const user=await identity(request),current=await load(user),body=input.parse(await privateJson(request));
 if(body.action==='track-scan'){const scan=await getCareer<import('@/lib/scans').ScanData>(user,'scans',body.scanId);if(!scan.data.trackerId)await updateCareer(user,scan,scan.version,{...scan.data,trackerId:'scan-'+scan.id});const items=await syncTracker(user,current.state);return response({item:items.find(r=>r.data.scanId===scan.id)});}
 if(body.action==='create'){if(body.data.cvId)ownedFile(current.state,body.data.cvId);const data=applyTrackerEdit(blankTracker(),body.data);return response({record:await createCareer(user,'tracker',data)});}
 const old=await getCareer<TrackerItem>(user,'tracker',body.id);if(old.data.deleted)throw new DomainError('This tracker item was removed.',404);
 if(body.action==='delete')return response({record:await updateCareer(user,old,body.version,{...old.data,deleted:true,archived:true})});
 if(body.action==='save'){if(body.data.cvId)ownedFile(current.state,body.data.cvId);return response({record:await updateCareer(user,old,body.version,applyTrackerEdit(old.data,body.data))});}
 const interview=old.data.interviews.find(i=>i.id===body.interviewId);if(!interview)throw new DomainError('Interview not found.',404);let cv='';const id=old.data.cvId||current.state.selectedCvId;if(id){const file=ownedFile(current.state,id),object=await files().get(file.key);if(object)cv=(await extractResume(new Uint8Array(await object.arrayBuffer()),file.name)).text;}const basic=basicThankYou(old.data,interview,body.conversationPoint,body.template==='detailed');const draft=await writeText(user,{task:'interview_thank_you',system:'Write a short thank-you note for review using only supplied facts. Do not invent discussion details, qualifications or promises. Return only the note.',prompt:JSON.stringify({basic,cv,job:old.data.description,point:body.conversationPoint}).slice(0,28000),fallback:()=>basic});return response({draft:unsupportedRewrite(cv+'\n'+basic,draft)?basic:draft,reviewRequired:true});
 }catch(e){if(e instanceof z.ZodError)return response({error:e.issues[0]?.message||'Check the tracker fields.'},400);return failure(e);}}
