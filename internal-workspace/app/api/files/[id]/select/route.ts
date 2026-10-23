import { z } from 'zod';
import { identity, load, save, files, ownedFile, response, failure } from '@/lib/cyber-store';
import { DomainError, activateCv, record } from '@/lib/cyber-domain';
import { extractResume } from '@/lib/resume-extraction';

export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
const schema=z.object({revision:z.number().int().nonnegative()}).strict();

export async function POST(request:Request,context:Context){
 try{
  const user=await identity(request),origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON with the application/json content type.',415);
  if(Number(request.headers.get('content-length')||0)>1000)throw new DomainError('Request is too large.',413);
  const raw=await request.text();if(raw.length>1000)throw new DomainError('Request is too large.',413);
  let input:unknown;try{input=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
  const parsed=schema.safeParse(input);if(!parsed.success)throw new DomainError('A current workspace revision is required.');
  const {id}=await context.params,current=await load(user);
  if(current.revision!==parsed.data.revision)throw new DomainError('Your workspace changed. Reload before choosing a CV.',409);
  const file=ownedFile(current.state,id),object=await files().get(file.key);
  if(!object)throw new DomainError('The saved CV file is unavailable. Upload it again.',404);
  const extracted=await extractResume(new Uint8Array(await object.arrayBuffer()),file.name);
  activateCv(current.state,file,extracted);
  const message=`${file.name} is selected for new Apply requests. Review the refreshed candidate facts before using it. Existing unsent requests keep their earlier materials until you update each one in Applications.`;
  record(current.state,'select_cv',message,'interface');
  return response({user,...await save(user,current.revision,current.state,'select_cv'),message});
 }catch(error){return failure(error);}
}
