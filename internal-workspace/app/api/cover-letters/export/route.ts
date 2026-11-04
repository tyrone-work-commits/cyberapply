import {identity,load,failure} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {getCareer} from '@/lib/career-store';
import {letterDocument,type CoverLetter} from '@/lib/cover-letters';
import {resumePdf,resumeDocx} from '@/lib/resume-renderer';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);const q=new URL(request.url).searchParams,format=q.get('format')||'docx';if(!['pdf','docx'].includes(format))throw new DomainError('Unknown export format.');const letter=await getCareer<CoverLetter>(user,'coverLetters',q.get('id')||''),doc=letterDocument(letter.data),bytes=format==='pdf'?await resumePdf(doc):resumeDocx(doc);return new Response(new Uint8Array(bytes).buffer,{headers:{'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="cover-letter.${format}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return failure(e);}}
