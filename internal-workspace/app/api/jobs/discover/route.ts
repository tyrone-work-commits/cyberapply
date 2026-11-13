import { z } from 'zod';
import { identity, discoverJobs, response, failure } from '@/lib/cyber-store';
import { DomainError, connectionStatus } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
const bodySchema=z.object({revision:z.number().int().nonnegative(),settings:z.unknown().optional()}).strict();
export async function POST(request:Request){
 try{
  const user=await identity(request);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON with the application/json content type.',415);
  if(Number(request.headers.get('content-length')||0)>10000)throw new DomainError('Search request is too large.',413);
  const raw=await request.text();if(raw.length>10000)throw new DomainError('Search request is too large.',413);
  let decoded;try{decoded=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
  const parsed=bodySchema.safeParse(decoded);if(!parsed.success)throw new DomainError('A current revision and valid search settings are required.');
  return response({user,...await discoverJobs(user,parsed.data.revision,parsed.data.settings,'interface'),connections:connectionStatus});
 }catch(error){return failure(error);}
}
