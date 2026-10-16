import { identity, load, failure } from '@/lib/cyber-store';
import { DomainError } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{const user=await identity(request);const {id}=await context.params;const current=await load(user);const receipt=current.state.submissions?.find(item=>item.id===id);if(!user.demo||!receipt)throw new DomainError('Demo receipt not found in your workspace.',404);
 const text=['CYBERAPPLY — SIMULATED APPLICATION RECEIPT','Fictional demonstration only. No employer was contacted.',receipt.seeded?'Preloaded example receipt':'Created by a demo send action',`Receipt: ${receipt.id}`,`Company: ${receipt.company}`,`Role: ${receipt.role}`,`Recorded: ${receipt.at}`,`Draft version: ${receipt.draftVersion}`,'','CANDIDATE',receipt.candidate.fullName,receipt.candidate.email,'','APPLICATION TEXT',receipt.text,'','CV SNAPSHOT',receipt.candidate.resumeText].join('\n');
 return new Response(text,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${receipt.id}.txt"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return failure(error);}
}
