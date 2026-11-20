import {identity,load,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {getCareer} from '@/lib/career-store';
import {resumePdf,resumeDocx} from '@/lib/resume-renderer';
import type {ResumeDocument} from '@/lib/resume-builder';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);const q=new URL(request.url).searchParams,format=q.get('format')||'pdf';if(!['pdf','docx'].includes(format))throw new DomainError('Unknown export format.');const record=await getCareer<ResumeDocument>(user,'builder',q.get('id')||''),bytes=format==='pdf'?await resumePdf(record.data):resumeDocx(record.data);return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`${q.get('preview')==='1'&&format==='pdf'?'inline':'attachment'}; filename="resume-${record.id.slice(0,8)}.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return failure(e instanceof DomainError?e:new DomainError(e instanceof Error?e.message:'Could not export this résumé.'));}}
