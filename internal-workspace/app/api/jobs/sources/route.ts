import {z} from 'zod';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {privateJson} from '@/lib/career-store';
import {savedSources,saveSources,refreshSource,removeSource,refreshHours} from '@/lib/saved-job-sources';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);return response({items:await savedSources(user),refreshHours:refreshHours()});}catch(e){return failure(e);}}
const input=z.discriminatedUnion('action',[z.object({action:z.literal('save'),settings:z.unknown()}).strict(),z.object({action:z.literal('refresh'),id:z.string().min(1).max(100)}).strict(),z.object({action:z.literal('remove'),id:z.string().min(1).max(100),version:z.number().int().positive()}).strict()]);
export async function POST(request:Request){try{const user=await identity(request);await load(user);const body=input.parse(await privateJson(request));if(body.action==='save')return response({items:await saveSources(user,body.settings)});if(body.action==='remove')return response(await removeSource(user,body.id,body.version));return response(await refreshSource(user,body.id,true));}catch(e){if(e instanceof z.ZodError)return response({error:'Check the saved source settings.'},400);return failure(e);}}
