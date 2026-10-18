import { z } from 'zod';
import { identity, load, save, files, ownedFile, response, failure } from '@/lib/cyber-store';
import { DomainError } from '@/lib/cyber-domain';
import { extractResume } from '@/lib/resume-extraction';
import { wordPreview } from '@/lib/file-preview';
import { deleteSavedFile } from '@/lib/file-deletion';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function GET(request:Request,context:Context){
 try{
  const user=await identity(request),{id}=await context.params,current=await load(user),attachment=ownedFile(current.state,id);
  const view=new URL(request.url).searchParams.get('view');
  if(view!==null&&view!=='1')throw new DomainError('Unknown file view.');
  const object=await files().get(attachment.key);
  if(!object)throw new DomainError('The private file is unavailable.',404);
  if(view==='1'&&attachment.name.toLowerCase().endsWith('.docx')){
   const extracted=await extractResume(new Uint8Array(await object.arrayBuffer()),attachment.name);
   return new Response(wordPreview(attachment.name,extracted.text,`/api/files/${encodeURIComponent(id)}`),{headers:{...privateHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"}});
  }
  const type=attachment.type==='application/pdf'?'application/pdf':attachment.type==='text/plain'?'text/plain; charset=utf-8':attachment.type;
  const inline=view==='1'&&(attachment.type==='application/pdf'||attachment.type==='text/plain');
  return new Response(object.body,{headers:{...privateHeaders,'Content-Type':type,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`}});
 }catch(error){return failure(error);}
}
const deleteSchema=z.object({revision:z.number().int().nonnegative(),confirmation:z.literal('DELETE_FILE')}).strict();
export async function DELETE(request:Request,context:Context){
 try{
  const user=await identity(request),origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON with the application/json content type.',415);
  if(Number(request.headers.get('content-length')||0)>1000)throw new DomainError('Request is too large.',413);
  const raw=await request.text();if(raw.length>1000)throw new DomainError('Request is too large.',413);
  let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new DomainError('Invalid JSON.');}
  const body=deleteSchema.safeParse(decoded);if(!body.success)throw new DomainError('Confirm this file deletion with a current numeric revision.');
  const {id}=await context.params,current=await load(user);
  if(current.revision!==body.data.revision)throw new DomainError('Your workspace changed. Reload before deleting the file.',409);
  const result=await deleteSavedFile(current,id,{load:()=>load(user),save:(expected,state,action)=>save(user,expected,state,action),remove:key=>files().delete(key)});
  return response({user,...result});
 }catch(error){return failure(error);}
}
