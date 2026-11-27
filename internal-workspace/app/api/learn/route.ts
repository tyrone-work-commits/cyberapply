import {z} from 'zod';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {listCareer,createCareer,privateJson} from '@/lib/career-store';
import {learningRoles,learnArticles,learningRoleData} from '@/lib/learn-catalog';
import {learningMarkdown} from '@/lib/learn-content';
import {blankResume} from '@/lib/resume-builder';
import type {ScanData} from '@/lib/scans';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request),current=await load(user),id=new URL(request.url).searchParams.get('article');if(id){const article=learnArticles.find(a=>a.id===id);if(!article)throw new DomainError('Article not found.',404);return response({article:{...article,body:learningMarkdown[id]}});}const scans=await listCareer<ScanData>(user,'scans',{limit:100});return response({articles:learnArticles,roles:learningRoleData(current.state.jobs,scans.map(s=>s.data)),scope:'Skills are from your own saved jobs and up to 100 private scans, with curated fallbacks. They do not describe all applicants or prove you hold a skill.'});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await identity(request);await load(user);const input=z.object({action:z.literal('start-template'),roleId:z.string().max(50)}).strict().parse(await privateJson(request)),role=learningRoles.find(r=>r.id===input.roleId);if(!role)throw new DomainError('Choose an available role.');if((await listCareer(user,'builder',{limit:21})).length>=20)throw new DomainError('Keep up to 20 résumé documents.',409);const doc=blankResume();doc.templateId='security';doc.name=role.title+' — blank layout';doc.profile.title='Target role: '+role.title;doc.importNotice='Blank role layout. Example claims and skills were not copied. Add only your own verified details.';return response({record:await createCareer(user,'builder',doc)},201);}catch(e){return failure(e);}}
