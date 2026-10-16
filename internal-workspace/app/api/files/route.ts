import { identity, load, save, files, response, failure } from '@/lib/cyber-store';
import { DomainError, record } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  let createdKey:string|undefined;
  try{
    const user=await identity(request);
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)throw new DomainError('Cross-origin writes are not allowed.',403);
    if(Number(request.headers.get('content-length')||0)>5300000)throw new DomainError('Choose a file smaller than 5 MB.',413);
    const form=await request.formData();const file=form.get('file');const expected=Number(form.get('revision'));
    if(!(file instanceof File)||!file.size||file.size>5000000)throw new DomainError('Choose a PDF, DOCX or UTF-8 TXT file smaller than 5 MB.');
    const current=await load(user);
    if(!Number.isSafeInteger(expected)||expected!==current.revision)throw new DomainError('Your workspace changed. Reload before uploading.',409);
    if(current.state.attachments.length>=20)throw new DomainError('This pilot supports 20 private files.',409);
    const name=file.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180)||'resume.txt';
    const extension=name.split('.').pop()?.toLowerCase();const bytes=new Uint8Array(await file.arrayBuffer());
    let type='',text:string|undefined;
    if(extension==='txt'){
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new DomainError('The TXT file must use UTF-8 text.');}
      if(text.length>120000||text.includes('\0'))throw new DomainError('Use a UTF-8 résumé text file up to 120,000 characters.');
      type='text/plain';
    }else if(extension==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')type='application/pdf';
    else if(extension==='docx'&&bytes[0]===80&&bytes[1]===75)type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else throw new DomainError('The file content does not match a supported PDF, DOCX or TXT file.');
    const id=crypto.randomUUID();createdKey=`owners/${encodeURIComponent(user.userId)}/${id}`;
    await files().put(createdKey,bytes,{httpMetadata:{contentType:type}});
    current.state.attachments.unshift({id,key:createdKey,name,type,size:file.size,createdAt:new Date().toISOString(),textExtracted:text!==undefined});
    if(text!==undefined){delete current.state.resumeReview;current.state.profile.resumeText=text;current.state.profile.reviewed=false;current.state.drafts.forEach(draft=>{if(draft.status==='ready'){draft.status='draft';draft.version++;}});}
    const message=text!==undefined?'Private TXT file saved. Review the imported résumé text before preparing applications.':'Private file saved. PDF/DOCX text extraction is not connected in this pilot; paste and review its text in your profile.';
    record(current.state,'upload_file',message,'interface');
    const saved=await save(user,expected,current.state,'upload_file');createdKey=undefined;
    return response({user,...saved,message});
  }catch(error){if(createdKey){try{await files().delete(createdKey);}catch{console.error('New upload cleanup could not complete.');}}return failure(error);}
}
