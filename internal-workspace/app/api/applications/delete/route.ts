import {z} from 'zod';
import {MAX_APPLICATION_DELETE_SELECTION} from '@/lib/application-deletion';
import {identity,permanentlyDeleteApplications,applicationCleanupStatus,finishApplicationCleanup,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{return response(await applicationCleanupStatus(await identity(request)));}catch(error){return failure(error);}}
const schema=z.object({revision:z.number().int().nonnegative(),scope:z.enum(['application','selected','cleared','candidate_facts']),applicationId:z.string().min(1).max(300).optional(),applicationIds:z.array(z.string().min(1).max(300)).min(1).max(MAX_APPLICATION_DELETE_SELECTION).optional(),deleteCandidateFacts:z.boolean().optional(),confirmation:z.literal('PERMANENTLY DELETE')}).strict().superRefine((v,c)=>{if(v.scope==='application'&&!v.applicationId)c.addIssue({code:'custom',message:'Choose an application.'});if(v.scope!=='application'&&v.applicationId)c.addIssue({code:'custom',message:'Unexpected application ID.'});if(v.scope==='selected'){if(!v.applicationIds||new Set(v.applicationIds).size!==v.applicationIds.length||v.deleteCandidateFacts)c.addIssue({code:'custom',message:'Choose different applications only.'});}else if(v.applicationIds)c.addIssue({code:'custom',message:'Unexpected application IDs.'});});
export async function POST(request:Request){try{
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin){const length=request.headers.get('content-length');if(length!==null&&Number.isSafeInteger(Number(length))&&Number(length)>=0&&Number(length)<=40000)await request.arrayBuffer();else await request.body?.cancel();throw new DomainError('Cross-origin deletion is not allowed.',403);}
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 if(Number(request.headers.get('content-length')||0)>40000)throw new DomainError('Request is too large.',413);
 const raw=await request.text();if(raw.length>40000)throw new DomainError('Request is too large.',413);
 let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
 if(z.object({action:z.literal('finish_cleanup')}).strict().safeParse(decoded).success)return response(await finishApplicationCleanup(await identity(request)));
 const parsed=schema.safeParse(decoded);if(!parsed.success)throw new DomainError('Choose records and type PERMANENTLY DELETE to confirm.');
 const user=await identity(request),body=parsed.data;
 return response({user,...await permanentlyDeleteApplications(user,body.revision,body.scope,body.applicationId,body.deleteCandidateFacts,body.applicationIds)});
}catch(error){return failure(error);}}
