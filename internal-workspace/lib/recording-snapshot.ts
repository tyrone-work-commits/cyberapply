import type {Recording,RecordingSnapshot} from './recording-view-state';

export async function recordingSnapshot(base:string,signal:AbortSignal,fetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init)){
 let snapshot:RecordingSnapshot|undefined,cursor:string|null=null;const seen=new Set<string>(),items=new Map<string,Recording>();
 do{
  const response=await fetcher(base+(cursor?'&cursor='+encodeURIComponent(cursor):''),{cache:'no-store',signal});
  const page=await response.json() as RecordingSnapshot&{error?:string};if(!response.ok)throw Error(page.error||'Recordings could not be loaded.');
  if(snapshot&&(snapshot.currentAttempt!==page.currentAttempt||snapshot.applicationStatus!==page.applicationStatus))throw Error('The application changed while its recording index loaded. Reconnecting.');
  snapshot=page;
  for(const item of page.items){
   const previous=items.get(item.attempt);if(!previous){items.set(item.attempt,item);continue;}
   const parts=[...new Map([...(previous.parts||[]),...(item.parts||[])].map(part=>[part.part,part])).values()];
   items.set(item.attempt,{...item,parts,size:parts.reduce((n,p)=>n+(p.size||0),0),duration:parts.reduce((n,p)=>n+p.duration,0),partial:item.partial||previous.partial,recordedAt:item.recordedAt>previous.recordedAt?item.recordedAt:previous.recordedAt});
  }
  cursor=page.nextCursor;if(cursor){if(seen.has(cursor))throw Error('The recording index did not advance.');seen.add(cursor);}
 }while(cursor);
 return {...snapshot!,items:[...items.values()],nextCursor:null};
}
