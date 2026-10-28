import { identity, load, save, files, response, failure } from '@/lib/cyber-store';
import { DomainError, record, activateCv } from '@/lib/cyber-domain';
import { extractResume } from '@/lib/resume-extraction';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  let createdKey:string|undefined;
  try{
    const user=await identity(request);
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
    if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))throw new DomainError('Upload your CV using the file picker.',415);
    if(Number(request.headers.get('content-length')||0)>5300000)throw new DomainError('Choose a file smaller than 5 MB.',413);
    const form=await request.formData();const file=form.get('file');const expected=Number(form.get('revision'));
    if(!(file instanceof File)||!file.size||file.size>5000000)throw new DomainError('Choose a PDF, DOCX or UTF-8 TXT file smaller than 5 MB.');
    const current=await load(user);
    if(!Number.isSafeInteger(expected)||expected!==current.revision)throw new DomainError('Your workspace changed. Reload before uploading.',409);
    if(current.state.attachments.length>=20)throw new DomainError('This pilot supports 20 private files.',409);
    const name=file.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180)||'resume.txt';
    const bytes=new Uint8Array(await file.arrayBuffer());
    const extracted=await extractResume(bytes,name),{text,type}=extracted;
    const id=crypto.randomUUID();createdKey=`owners/${encodeURIComponent(user.userId)}/${id}`;
    await files().put(createdKey,bytes,{httpMetadata:{contentType:type}});
    const at=new Date().toISOString();
    current.state.attachments.unshift({id,key:createdKey,name,type,size:file.size,createdAt:at,textExtracted:true});
    activateCv(current.state,current.state.attachments[0],extracted,at);
    const message=`CV uploaded, selected for new Apply requests and scored: ${current.state.resumeReview!.score}/100. Review the CV and each application draft before using them.`;
    record(current.state,'upload_file',message,'interface');
    const saved=await save(user,expected,current.state,'upload_file');createdKey=undefined;
    return response({user,...saved,message});
  }catch(error){if(createdKey){try{await files().delete(createdKey);}catch{console.error('New upload cleanup could not complete.');}}return failure(error);}
}
