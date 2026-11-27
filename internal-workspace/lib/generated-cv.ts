import {identity,load,files,save,ownedFile,type Identity} from './cyber-store';
import {DomainError,record} from './cyber-domain';
import {extractResume} from './resume-extraction';
import {simpleDocx,preserveDocx} from './document-export';
import {resumeText,type Optimization} from './optimize';
export async function optimizationDocx(user:Identity,session:Optimization,clean=false){
 if(!clean&&session.source.fileKind?.toLowerCase()==='docx'){
  let key=session.source.sourceKey;
  if(!key&&session.source.resumeId){const current=await load(user);key=ownedFile(current.state,session.source.resumeId).key;}
  if(!key?.startsWith(`owners/${encodeURIComponent(user.userId)}/`))throw new DomainError('The original file is unavailable. Choose clean-layout export.',409);
  const original=await files().get(key);if(!original)throw new DomainError('The original file is unavailable. Choose clean-layout export.',409);
  return preserveDocx(new Uint8Array(await original.arrayBuffer()),session.blocks);
 }
 return simpleDocx(resumeText(session.blocks));
}
export async function saveGeneratedCv(user:Identity,bytes:Uint8Array,name:string){
 const parsed=await extractResume(bytes,name);if(/\[(?:edit|actual|verified|describe|your real|real )/i.test(parsed.text))throw new DomainError('Replace draft placeholders with your own verified details before saving this CV for applications.');
 const current=await load(user);if(current.state.attachments.length>=20)throw new DomainError('Your CV library has 20 files. Remove an unneeded file before saving a new version.',409);
 const id=crypto.randomUUID(),key=`owners/${encodeURIComponent(user.userId)}/${id}`,at=new Date().toISOString();
 await files().put(key,bytes,{httpMetadata:{contentType:parsed.type}});
 try{current.state.attachments.unshift({id,key,name,type:parsed.type,size:bytes.length,createdAt:at,textExtracted:true});record(current.state,'save_career_cv','Saved a new generated CV version. The chosen application CV was not changed.','interface');await save(user,current.revision,current.state,'save_career_cv');return{id,name};}catch(error){try{await files().delete(key);}catch{}throw error;}
}
