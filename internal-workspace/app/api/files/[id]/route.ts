import { identity, load, files, ownedFile, failure } from '@/lib/cyber-store';
import { DomainError } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{const user=await identity(request);const {id}=await context.params;const current=await load(user);const attachment=ownedFile(current.state,id);const object=await files().get(attachment.key);if(!object)throw new DomainError('The private file is unavailable.',404);return new Response(object.body,{headers:{'Content-Type':attachment.type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return failure(error);}
}
