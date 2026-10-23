import { authorizeAgent } from '@/lib/agent-bridge';
import { files, failure, ownedFile } from '@/lib/cyber-store';
import { DomainError } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {current}=await authorizeAgent(request),params=new URL(request.url).searchParams,id=params.get('applicationId'),claimId=params.get('claimId');
 const application=current.state.applications?.find(item=>item.id===id&&item.status==='processing'&&item.claim?.id===claimId);
 if(!application?.cv)throw new DomainError('That claimed CV is unavailable.',404);
 const file=ownedFile(current.state,application.cv.fileId);
 if(file.name!==application.cv.name||file.size!==application.cv.size)throw new DomainError('The chosen CV changed after the swipe.',409);
 const object=await files().get(file.key);if(!object)throw new DomainError('The chosen CV is unavailable.',404);
 return new Response(object.body,{headers:{'Content-Type':file.type,'Content-Length':String(file.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`}});
 }catch(error){return failure(error);}}
