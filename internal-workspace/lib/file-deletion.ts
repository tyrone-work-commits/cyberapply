import { DomainError, record, type State } from './cyber-domain';
type Snapshot={revision:number;state:State};
type Storage<S extends Snapshot>={load:()=>Promise<S>;save:(expected:number,state:State,action:string)=>Promise<S>;remove:(key:string)=>Promise<unknown>};

// Removal is durable before R2 cleanup. A pending entry allows explicit recovery
// after a storage failure or lost response, without reviving access to the file.
export async function deleteSavedFile<S extends Snapshot>(current:S,id:string,storage:Storage<S>){
 const file=current.state.attachments.find(item=>item.id===id),pending=current.state.pendingFileDeletions?.find(item=>item.id===id);
 if(!file&&!pending)throw new DomainError('File not found in your workspace.',404);
 let saved=current;
 if(file){
  if((current.state.pendingFileDeletions?.length||0)>=20)throw new DomainError('Finish pending file deletions before deleting another file.',409);
  const state=structuredClone(current.state);state.attachments=state.attachments.filter(item=>item.id!==id);
  if(state.selectedCvId===id)delete state.selectedCvId;
  state.applications?.filter(item=>item.cv?.fileId===id&&['queued','needs_action','needs_attention','failed'].includes(item.status)).forEach(item=>{item.reason='materials_changed';item.status='needs_action';delete item.agentAuthorizedAt;});
  state.pendingFileDeletions=[...(state.pendingFileDeletions||[]),file];
  record(state,'delete_file',`Removed saved file: ${file.name}. Extracted CV text and review retained.`,'interface');
  saved=await storage.save(current.revision,state,'delete_file');
 }
 const target=file||pending!;
 try{await storage.remove(target.key);}catch{const latest=await storage.load().catch(()=>saved);return {...latest,message:'The file is removed from your saved list. Storage cleanup is pending; use Retry deletion below. Your CV text and review are unchanged.'};}
 try{
  // Keep any edits that arrived while R2 cleanup was running.
  const latest=await storage.load();
  if(!latest.state.pendingFileDeletions?.some(item=>item.id===id))return {...latest,message:'File deleted. Your CV text and review are unchanged.'};
  const state=structuredClone(latest.state);state.pendingFileDeletions=state.pendingFileDeletions!.filter(item=>item.id!==id);
  if(!state.pendingFileDeletions.length)delete state.pendingFileDeletions;
  const finished=await storage.save(latest.revision,state,'finish_file_deletion');
  return {...finished,message:'File deleted. Your CV text and review are unchanged.'};
 }catch{
  // R2 deletion is idempotent. Leave bookkeeping recoverable rather than
  // repeating an uncertain mutation or overwriting a concurrent change.
  const latest=await storage.load().catch(()=>saved);
  return {...latest,message:'The original file was deleted. Finalizing the saved list is pending; use Retry deletion below. Your CV text and review are unchanged.'};
 }
}
