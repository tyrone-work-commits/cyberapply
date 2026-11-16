/** Accepted by retained record tools; CV review itself now has files only. */
export type CvReviewTool='files'|'scan'|'optimize';
type Destination={tool:CvReviewTool;id:string|undefined;href:string};

/** Retired matching/optimization links return to the current CV files page. */
export function cvReviewHref(_tool:CvReviewTool='files',_id?:string){
 return '/workspace?view=workspace';
}

export function cvReviewDestination(params:URLSearchParams):Destination|null{
 const view=params.get('view')||'';
 if(view!=='workspace'&&!['scan','optimize','linkedin'].some(tool=>view===tool||view.startsWith(tool+':')))return null;
 // Do not carry retired report IDs or creation context into CV files.
 return {tool:'files',id:undefined,href:cvReviewHref()};
}
