export type VideoPart={part:number|null;duration:number};
export type Recording={attempt:string;duration:number;startedAt:string;recordedAt:string;partial:boolean;reason:string;size:number;parts?:VideoPart[]};
export type CaptureStatus={state:string;code:string;parts:number;partial:boolean;at:string;attempt:string};
export type RecordingSnapshot={items:Recording[];nextCursor:string|null;status:CaptureStatus|null;applicationStatus:string;currentAttempt:string|null;applicationUpdatedAt:string;employer:{title:string;company:string;url:string|null}};

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
 if(snapshot.applicationStatus==='queued')return 'Waiting for the agent to start the latest attempt. Earlier recordings are available under Recorded run.';
 if(status?.state==='upload_pending')return 'The latest recording is waiting to finish uploading. Keep the background agent connected; video-only retries never apply again.';
 if(status?.state==='capturing'){
  if(now-Date.parse(status.at)>45000&&!['queued','processing'].includes(snapshot.applicationStatus))return 'Capture stopped reporting. Available footage remains playable while the final recording is checked.';
  return 'Recording the latest attempt. This continuous video updates automatically as footage is uploaded.';
 }
 if(status?.state==='failed')return status.code==='no_frames'?'No browser frames were captured for the latest attempt. Earlier recordings cannot show this run.':'Capture failed for the latest attempt. Any available footage remains playable.';
 if(status?.state==='interrupted')return 'The latest recording was interrupted. Available footage remains playable; the employer outcome is separate.';
 if(status?.state==='saved'&&current)return current.partial||status.partial?'The latest recording is saved but partial.':'The latest recording is saved and ready to replay.';
 if(!current)return ['queued','processing'].includes(snapshot.applicationStatus)?'Waiting for footage from the latest attempt. It will appear automatically.':'No recording is available for the latest attempt yet. Checking for its upload automatically; missing footage cannot be recreated.';
 return 'Available footage from the latest attempt. Checking automatically for the final recording.';
}
