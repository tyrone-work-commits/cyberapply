import {z} from 'zod';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {createCareer,listCareer,deleteCareer,privateJson} from '@/lib/career-store';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);return response({items:await listCareer(user,'excludedSkills',{limit:100})});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const user=await identity(request);await load(user);const body=z.object({skill:z.string().trim().min(1).max(100)}).strict().parse(await privateJson(request));const rows=await listCareer<{skill:string}>(user,'excludedSkills',{limit:100});const found=rows.find(r=>r.data.skill.toLowerCase()===body.skill.toLowerCase());return response({record:found||await createCareer(user,'excludedSkills',body)});}catch(error){return failure(error);}}
export async function DELETE(request:Request){try{const user=await identity(request);await load(user);const body=z.object({id:z.string().min(1),version:z.number().int().positive()}).strict().parse(await privateJson(request));return response(await deleteCareer(user,'excludedSkills',body.id,body.version));}catch(error){return failure(error);}}
