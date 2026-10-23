import { z } from 'zod';
import { identity, accountStatus, deleteAccount, response, failure } from '@/lib/cyber-store';
import { DomainError } from '@/lib/cyber-domain';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const user=await identity(request);
    return response({email:user.email,...await accountStatus(user)});
  }catch(error){return failure(error);}
}

const schema=z.object({revision:z.number().int().nonnegative(),confirmation:z.literal('DELETE CYBERAPPLY')}).strict();
export async function DELETE(request:Request){
  try{
    const user=await identity(request);
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON with the application/json content type.',415);
    if(Number(request.headers.get('content-length')||0)>1000)throw new DomainError('Request is too large.',413);
    const raw=await request.text();if(raw.length>1000)throw new DomainError('Request is too large.',413);
    let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
    const body=schema.safeParse(decoded);if(!body.success)throw new DomainError('Type DELETE CYBERAPPLY to confirm account deletion.');
    return response(await deleteAccount(user,body.data.revision));
  }catch(error){return failure(error);}
}
