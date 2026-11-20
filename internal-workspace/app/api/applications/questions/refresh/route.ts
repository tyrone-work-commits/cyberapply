import {z} from 'zod';
import {identity,refreshApplicationQuestionChoices,response,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
const input=z.object({revision:z.number().int().nonnegative(),applicationId:z.string().min(1).max(300)}).strict();
export async function POST(request:Request){try{
 const user=await identity(request),origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 if(Number(request.headers.get('content-length')||0)>2000)throw new DomainError('Request too large.',413);
 const raw=await request.text();if(raw.length>2000)throw new DomainError('Request too large.',413);
 let body;try{body=input.parse(JSON.parse(raw));}catch{throw new DomainError('A current revision and application are required.');}
 return response({user,...await refreshApplicationQuestionChoices(user,body.revision,body.applicationId)});
}catch(error){return failure(error);}}
