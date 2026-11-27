import {identity,load,failure} from '@/lib/cyber-store';
import {getCareer} from '@/lib/career-store';
import {optimizationDocx} from '@/lib/generated-cv';
import {resumeText,type Optimization} from '@/lib/optimize';
import {importResume} from '@/lib/resume-builder';
import {resumePdf} from '@/lib/resume-renderer';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);const q=new URL(request.url).searchParams;const record=await getCareer<Optimization>(user,'optimize',q.get('id')||'');const pdf=q.get('format')==='pdf';const bytes=pdf?await resumePdf(importResume(resumeText(record.data.blocks))):await optimizationDocx(user,record.data,q.get('layout')==='clean');return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':pdf?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="optimized-cv-${record.id.slice(0,8)}.${pdf?'pdf':'docx'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return failure(error);}}
