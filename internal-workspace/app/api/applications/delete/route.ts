import {z} from 'zod';
import {identity,permanentlyDeleteApplications,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
const schema=z.object({revision:z.number().int().nonnegative(),scope:z.enum(['application','cleared','candidate_facts']),applicationId:z.string().min(1).max(300).optional(),deleteCandidateFacts:z.boolean().optional(),confirmation:z.literal('PERMANENTLY DELETE')}).strict().superRefine((v,c)=>{if(v.scope==='application'&&!v.applicationId)c.addIssue({code:'custom',message:'Choose an application.'});if(v.scope!=='application'&&v.applicationId)c.addIssue({code:'custom',message:'Unexpected application ID.'});});
export async function POST(request:Request){try{
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin deletion is not allowed.',403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 if(Number(request.headers.get('content-length')||0)>5000)throw new DomainError('Request is too large.',413);
 const raw=await request.text();if(raw.length>5000)throw new DomainError('Request is too large.',413);
 let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
 const parsed=schema.safeParse(decoded);if(!parsed.success)throw new DomainError('Choose records and type PERMANENTLY DELETE to confirm.');
 const user=await identity(request),body=parsed.data;
 return response({user,...await permanentlyDeleteApplications(user,body.revision,body.scope,body.applicationId,body.deleteCandidateFacts)});
}catch(error){return failure(error);}}
