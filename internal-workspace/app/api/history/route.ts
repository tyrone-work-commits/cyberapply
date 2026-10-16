import { identity, history, revision, response, failure } from '@/lib/cyber-store';
import { DomainError } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);const url=new URL(request.url);const requested=url.searchParams.get('revision');if(requested!==null){const number=Number(requested);if(!Number.isSafeInteger(number)||number<1)throw new DomainError('Invalid revision.');return response(await revision(user,number));}const before=Number(url.searchParams.get('before')||2147483647);if(!Number.isSafeInteger(before)||before<1)throw new DomainError('Invalid history cursor.');return response({items:await history(user,before)});}catch(error){return failure(error);}}
