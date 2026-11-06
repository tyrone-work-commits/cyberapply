export type CvReviewTool='files'|'scan'|'optimize'|'linkedin';

/** CV matching and editing share CV review; saved record IDs remain deep-linkable. */
export function cvReviewHref(tool:CvReviewTool='files',id?:string){
 const params=new URLSearchParams({view:'workspace'});
 if(tool!=='files')params.set('tool',tool);
 if(id&&tool!=='files')params.set(tool==='scan'?'report':'session',id);
 return '/workspace?'+params.toString();
}

export function cvReviewDestination(params:URLSearchParams){
 const view=params.get('view')||'';
 let tool:CvReviewTool;
 if(view==='scan'||view.startsWith('scan:'))tool='scan';
 else if(view==='optimize'||view.startsWith('optimize:'))tool='optimize';
 else if(view==='linkedin')tool='linkedin';
 else if(view==='workspace')tool=params.get('tool')==='scan'?'scan':params.get('tool')==='optimize'?'optimize':params.get('tool')==='linkedin'?'linkedin':'files';
 else return null;
 const legacy=view.startsWith(tool+':')?view.slice(tool.length+1):undefined;
 const id=legacy||params.get(tool==='scan'?'report':'session')||undefined;
 const canonical=new URLSearchParams(cvReviewHref(tool,id).split('?')[1]);
 // Retain only known context parameters when an old link is opened.
 for(const key of ['job','scan']){const value=params.get(key);if(value)canonical.set(key,value);}
 return {tool,id,href:'/workspace?'+canonical.toString()};
}
