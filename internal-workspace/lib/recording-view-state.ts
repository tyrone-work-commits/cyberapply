export type VideoPart={part:number|null;duration:number;size?:number};
export type Recording={attempt:string;duration:number;startedAt:string;recordedAt:string;partial:boolean;reason:string;size:number;parts?:VideoPart[]};
export type CaptureStatus={state:string;code:string;parts:number;partial:boolean;at:string;attempt:string};
export type RecordingSnapshot={items:Recording[];nextCursor:string|null;status:CaptureStatus|null;applicationStatus:string;currentAttempt:string|null;applicationUpdatedAt:string;employer:{title:string;company:string;url:string|null}};
export type RecordingTimeline={duration:number;recordedAt:string;partial:boolean;size:number;parts:(VideoPart&{attempt:string})[]};

// Watch Live may replay checkpoints; Watch Recording waits for a finished process.
// An ended browser or an uploaded checkpoint does not establish completion.
export function recordingAvailability(snapshot:RecordingSnapshot|null){
 if(!snapshot)return {ready:false,heading:'Checking application progress',message:'Checking whether the application process has finished.'};
 if(!['applied','failed'].includes(snapshot.applicationStatus))return {
  ready:false,heading:'Application process has not finished',
  message:snapshot.applicationStatus==='uncertain'
   ?'The employer outcome is still unverified. Check the outcome in Applications before any retry. The recording will appear here after the process is resolved.'
   :'The recording will appear here automatically after the application process finishes. You can use Watch Live to see the available work so far, including while the agent waits for your input or final submission.',
 };
 const status=snapshot.status?.attempt===snapshot.currentAttempt?snapshot.status:null;
 if(status&&['capturing','upload_pending'].includes(status.state))return {ready:false,heading:'Finishing your recording',message:'The application process has ended. Its recording is still being saved or uploaded and will appear here automatically.'};
 return {ready:true,heading:'',message:''};
}

// Parts are private source fragments of one application video, not selectable versions.
export function applicationRecordingTimeline(snapshot:Pick<RecordingSnapshot,'items'|'nextCursor'>):RecordingTimeline|null{
 if(snapshot.nextCursor)throw Error('The recording index is still loading.');
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
 return {parts,size,duration,recordedAt,partial};
}

// A resumed application has a new claim. Earlier footage must never masquerade as that run.
export function latestRecordingAttempt(snapshot:Pick<RecordingSnapshot,'items'|'currentAttempt'|'applicationStatus'>){
 if(snapshot.applicationStatus==='queued')return '';
 return snapshot.currentAttempt||snapshot.items[0]?.attempt||'';
}
export function recordingPollDelay(snapshot:Pick<RecordingSnapshot,'status'|'applicationStatus'>,live=false){
 return ['queued','processing'].includes(snapshot.applicationStatus)||live&&snapshot.applicationStatus==='needs_attention'||['capturing','upload_pending'].includes(snapshot.status?.state||'')?5000:15000;
}
export type LiveVideoInfo={status:string;control?:string;privateCheck?:boolean};
export function liveVideoPhase(status:string|undefined,info:LiveVideoInfo|null|undefined,atEnd=false,history=false){
 status=info?.status||status;
 const control=info?.privateCheck?'private':info?.control==='manual'?'manual':info?.control==='resuming'?'resuming':info?.control==='submit'?'submit':status==='needs_attention'||info?.control==='needs_input'?'needs_input':status==='queued'?'queued':info?.control==='ended'?'ended':status==='processing'?'agent':!status?'connecting':'ended';
 const caption=control==='private'?'Private verification — footage hidden':control==='manual'?'You have control — agent is waiting':control==='resuming'?'Agent is resuming with your answers':control==='submit'?'Ready — submit it yourself':control==='needs_input'?'Agent has requested user input':control==='queued'?'Waiting for the agent to continue':control==='agent'?'Agent is filling the application':control==='connecting'?'Connecting to application video':'Application session ended';
 const ongoing=control!=='ended';
 const label=control==='connecting'?'Connecting to live video':history?'Watching earlier footage':control==='needs_input'?'Live · waiting for user input':control==='manual'?'Live · user has control':control==='queued'||control==='resuming'?'Live · waiting for resumed footage':control==='submit'?'Live · waiting for your submission':control==='private'?'Live · private check':atEnd?ongoing?'Live · waiting for new footage':'Stream ended · replay available':'Buffered live';
 return {control,caption,label,ongoing};
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
 if(status?.state==='failed'){
  if(!snapshot.items.length)return 'No video footage was captured for this application run. There is no recording to replay. See Applications for its status and questions; missing footage cannot be recreated.';
  return status.code==='no_frames'?'No new frames were captured during the continuation. The video still shows earlier work; missing footage cannot be recreated.':'Capture stopped. The video still shows all available work so far.';
 }
 if(status?.state==='interrupted')return 'Capture was interrupted. The video shows available work so far; the employer outcome is separate.';
 if(status?.state==='saved'&&current)return current.partial||status.partial?'The updated application video is saved but partial.':'Your updated application video is saved and ready to replay.';
 if(!current)return snapshot.items.length?'Showing work recorded so far. Waiting for new footage to extend this same video.':'Waiting for recorded footage. It will appear here automatically; missing footage cannot be recreated.';
 return 'Showing work recorded so far. Checking automatically for more footage.';
}
