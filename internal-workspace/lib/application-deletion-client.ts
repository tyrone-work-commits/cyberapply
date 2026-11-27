import type {State} from './cyber-domain';
import type {DeletionScope} from './application-deletion';
type Selection={scope:DeletionScope;applicationId?:string;applicationIds?:string[]};
type Snapshot={revision:number;state:State;message?:string;cleanupPending?:number};
type Read=<T>(url:string,options?:RequestInit)=>Promise<T>;
/** Refresh before a destructive write; reconcile response loss without replaying it. */
export async function deleteConfirmedApplications<T extends Snapshot>(selection:Selection,legacy:boolean,transport:Read):Promise<T>{
 const read:Read=(url,options)=>transport(url,{...options,signal:AbortSignal.timeout(30000)});
 const current=await read<T>('/api/workspace');
 const ids=selection.scope==='selected'?selection.applicationIds||[]:selection.scope==='application'?[selection.applicationId!]:selection.scope==='cleared'?(current.state.applicationArchive?.applications||[]).map(a=>a.id):[];
 const missing=(state:State)=>ids.length>0&&ids.every(id=>![...(state.applications||[]),...(state.applicationArchive?.applications||[])].some(a=>a.id===id));
 const reconciled=async(latest:T)=>({...latest,cleanupPending:0,message:'Application records deleted. Private videos stay in Settings → Private videos.'});
 if(!legacy&&missing(current.state))return reconciled(current);
 try{return await read<T>('/api/applications/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,...selection,deleteCandidateFacts:legacy,confirmation:'PERMANENTLY DELETE'})});}
 catch(error){
  try{const latest=await read<T>('/api/workspace');if(!legacy&&missing(latest.state))return reconciled(latest);}catch{/* Preserve the original error if confirmation reads also fail. */}
  throw error;
 }
}
