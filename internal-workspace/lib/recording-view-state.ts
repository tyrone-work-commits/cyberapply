export type VideoPart={part:number|null;duration:number;size?:number};
export type Recording={attempt:string;duration:number;startedAt:string;recordedAt:string;partial:boolean;reason:string;size:number;parts?:VideoPart[]};
export type CaptureStatus={state:string;code:string;parts:number;partial:boolean;at:string;attempt:string};
export type RecordingSnapshot={items:Recording[];nextCursor:string|null;status:CaptureStatus|null;applicationStatus:string;currentAttempt:string|null;applicationUpdatedAt:string;employer:{title:string;company:string;url:string|null}};
export type RecordingTimeline={duration:number;recordedAt:string;partial:boolean;size:number;parts:(VideoPart&{attempt:string})[]};

// Parts are private source fragments of one application video, not selectable versions.
export function applicationRecordingTimeline(snapshot:Pick<RecordingSnapshot,'items'|'nextCursor'>):RecordingTimeline|null{
 if(snapshot.nextCursor)throw Error('This application video exceeds the playback limit. Its footage has not been deleted.');
 const items=[...snapshot.items].sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.attempt.localeCompare(b.attempt));
 if(!items.length)return null;
 const parts:RecordingTimeline['parts']=[];let size=0,partial=false,recordedAt='';
 for(const item of items){
  const available=item.parts?.length?item.parts:[{part:null,duration:item.duration,size:item.size}];
  const full=available.find(part=>part.part===null),ordered=full?[full]:[...available].sort((a,b)=>a.part!-b.part!);
  partial ||= item.partial||!full&&ordered.some((part,index)=>part.part!==index);
  size+=full?.size??item.size;
  if(item.recordedAt>recordedAt)recordedAt=item.recordedAt;
  for(const part of ordered)parts.push({...part,attempt:item.attempt});
 }
 const duration=parts.reduce((sum,part)=>sum+part.duration,0);
 if(parts.length>360||size>48_000_000||duration>3600)throw Error('This application video exceeds the playback limit. Its footage has not been deleted.');
 return {parts,size,duration,recordedAt,partial};
}

// A resumed application has a new claim. Earlier footage must never masquerade as that run.
export function latestRecordingAttempt(snapshot:Pick<RecordingSnapshot,'items'|'currentAttempt'|'applicationStatus'>){
 if(snapshot.applicationStatus==='queued')return '';
 return snapshot.currentAttempt||snapshot.items[0]?.attempt||'';
}
export function recordingPollDelay(snapshot:Pick<RecordingSnapshot,'status'|'applicationStatus'>){
 return ['queued','processing'].includes(snapshot.applicationStatus)||['capturing','upload_pending'].includes(snapshot.status?.state||'')?5000:15000;
}
export function recordingViewMessage(snapshot:RecordingSnapshot,now=Date.now()){
 const attempt=latestRecordingAttempt(snapshot),current=snapshot.items.find(item=>item.attempt===attempt);
 const status=snapshot.status?.attempt===attempt?snapshot.status:null;
 if(snapshot.applicationStatus==='queued')return 'Showing work recorded so far. The same video will extend when the agent continues and uploads more footage.';
 if(status?.state==='upload_pending')return 'Showing work recorded so far while the updated video finishes uploading. Keep the background agent connected; video-only retries never apply again.';
 if(status?.state==='capturing'){
  if(now-Date.parse(status.at)>45000&&!['queued','processing'].includes(snapshot.applicationStatus))return 'Capture stopped reporting. Available footage remains playable while the final recording is checked.';
  return 'Recording in progress. New footage extends this same continuous application video automatically.';
 }
 if(status?.state==='failed')return status.code==='no_frames'?'No new frames were captured during the continuation. The video still shows earlier work; missing footage cannot be recreated.':'Capture stopped. The video still shows all available work so far.';
 if(status?.state==='interrupted')return 'Capture was interrupted. The video shows available work so far; the employer outcome is separate.';
 if(status?.state==='saved'&&current)return current.partial||status.partial?'The updated application video is saved but partial.':'Your updated application video is saved and ready to replay.';
 if(!current)return snapshot.items.length?'Showing work recorded so far. Waiting for new footage to extend this same video.':'Waiting for recorded footage. It will appear here automatically; missing footage cannot be recreated.';
 return 'Showing work recorded so far. Checking automatically for more footage.';
}
