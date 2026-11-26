import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile} from 'node:fs/promises';
async function module(name){const code=ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const {applicationRecordingTimeline,recordingAvailability,recordingPollDelay,recordingViewMessage,liveVideoPhase}=await module('recording-view-state');
const {applicationEmployerLink}=await module('application-employer-link');
const at='2026-11-13T12:00:00Z',old={attempt:'old',duration:2,startedAt:at,recordedAt:at,partial:false,reason:'',size:100};
const snapshot=overrides=>({items:[old],nextCursor:null,status:{state:'saved',attempt:'old',at,parts:1,partial:false,code:''},applicationStatus:'needs_attention',currentAttempt:'old',applicationUpdatedAt:at,employer:{title:'Fictional role',company:'Fixture',url:'https://employer.example/apply'},...overrides});

test('saved playback waits through questions, manual submission and unresolved outcomes even with uploaded footage',()=>{
 assert.equal(recordingAvailability(null).ready,false);
 for(const applicationStatus of ['needs_action','queued','processing','needs_attention','uncertain','unknown']){
  const s=snapshot({applicationStatus});const state=recordingAvailability(s);
  assert.equal(state.ready,false,applicationStatus);assert.equal(state.heading,'Application process has not finished');
  assert.ok(applicationRecordingTimeline(s),'Watch Live still has its continuous footage');
 }
 assert.match(recordingAvailability(snapshot({applicationStatus:'uncertain'})).message,/unverified.*before any retry/);
});

test('finished processes expose recordings only after the current upload settles and hide them again on continuation',()=>{
 for(const applicationStatus of ['applied','failed']){
  for(const state of ['capturing','upload_pending'])assert.equal(recordingAvailability(snapshot({applicationStatus,status:{state,attempt:'old'}})).ready,false);
  for(const state of ['saved','failed','interrupted'])assert.equal(recordingAvailability(snapshot({applicationStatus,status:{state,attempt:'old'}})).ready,true);
  assert.equal(recordingAvailability(snapshot({applicationStatus,status:null})).ready,true,'legacy footage remains available');
  assert.equal(recordingAvailability(snapshot({applicationStatus,status:{state:'capturing',attempt:'unrelated'}})).ready,true,'old capture metadata is not the current upload');
 }
 assert.equal(recordingAvailability(snapshot({applicationStatus:'applied'})).ready,true);
 assert.equal(recordingAvailability(snapshot({applicationStatus:'queued',currentAttempt:null})).ready,false);
});

test('one video retains work so far and grows after answers are saved and the agent continues',()=>{
 const initial=applicationRecordingTimeline(snapshot());assert.equal(initial.duration,2);assert.equal(initial.parts.length,1);
 const queued=snapshot({currentAttempt:null,applicationStatus:'queued',status:null});
 assert.deepEqual(applicationRecordingTimeline(queued),initial);assert.match(recordingViewMessage(queued),/Showing work recorded so far/);
 const processing=snapshot({currentAttempt:'new',applicationStatus:'processing',status:null});
 assert.deepEqual(applicationRecordingTimeline(processing),initial);assert.match(recordingViewMessage(processing),/Waiting for new footage/);
 const final=snapshot({currentAttempt:'new',applicationStatus:'uncertain',items:[{...old,attempt:'new',startedAt:'2026-11-13T12:05:00Z',duration:80},old],status:{state:'saved',attempt:'new',at,parts:9,partial:false,code:''}});
 const updated=applicationRecordingTimeline(final);assert.equal(updated.duration,82);assert.deepEqual(updated.parts.map(part=>part.attempt),['old','new']);assert.equal(updated.parts.length,2);
 assert.match(recordingViewMessage(final),/saved and ready/);assert.equal(final.applicationStatus,'uncertain');
 assert.equal(applicationRecordingTimeline(snapshot({items:[{...old,duration:80}],applicationStatus:'applied'})).duration,80,'a direct finish needs no questions or continuation');
});
test('polling continues after saved footage so later attempts and delayed uploads are discovered',()=>{
 assert.equal(recordingPollDelay(snapshot()),15000);
 for(const applicationStatus of ['queued','processing'])assert.equal(recordingPollDelay(snapshot({applicationStatus})),5000);
 assert.equal(recordingPollDelay(snapshot({applicationStatus:'uncertain',status:{state:'upload_pending'}})),5000);
 assert.equal(recordingPollDelay(snapshot({applicationStatus:'applied'})),15000);
 assert.equal(recordingPollDelay(snapshot({applicationStatus:'needs_attention'}),true),5000,'the live player keeps checking during ordinary answer entry');
});

test('live video stays open at an input pause, waits through queuing and resumes without declaring an ended stream',()=>{
 const waiting=liveVideoPhase('needs_attention',null,true,false);
 assert.equal(waiting.caption,'Agent has requested user input');assert.equal(waiting.ongoing,true);assert.match(waiting.label,/Live.*waiting for user input/);
 const queued=liveVideoPhase('queued',null,true,false);assert.equal(queued.control,'queued');assert.equal(queued.ongoing,true);
 const resumed=liveVideoPhase('processing',{status:'processing',control:'agent'},true,false);assert.match(resumed.label,/waiting for new footage/);assert.match(resumed.caption,/filling the application/);
 assert.equal(liveVideoPhase('processing',{status:'processing',control:'manual'}).control,'manual');
 assert.equal(liveVideoPhase('processing',{status:'processing',control:'resuming'}).caption,'Agent is resuming with your answers');
 assert.equal(liveVideoPhase('processing',{status:'processing',control:'submit'}).control,'submit');
 assert.equal(liveVideoPhase('processing',{status:'processing',control:'needs_input',privateCheck:true}).control,'private');
 assert.equal(liveVideoPhase('needs_attention',null,true,true).label,'Watching earlier footage');
 for(const status of ['applied','uncertain','failed']){const ended=liveVideoPhase(status,null,true);assert.equal(ended.ongoing,false);assert.match(ended.label,/Stream ended/);}
 assert.equal(liveVideoPhase(undefined,null).control,'connecting');
 assert.equal(liveVideoPhase('processing',{status:'processing',control:'ended'},true).ongoing,false,'an expired or lost browser claim is not a live stream');
});
test('late or failed footage remains separate from submission and old status is ignored',()=>{
 assert.match(recordingViewMessage(snapshot({currentAttempt:'new',applicationStatus:'uncertain'})),/Showing work recorded so far/);
 assert.match(recordingViewMessage(snapshot({status:{state:'upload_pending',attempt:'old'}})),/uploading.*never apply again/);
 assert.match(recordingViewMessage(snapshot({status:{state:'failed',attempt:'old',code:'no_frames'}})),/No new frames/);
 const emptyFailure=recordingViewMessage(snapshot({items:[],status:{state:'failed',attempt:'old',code:'no_frames'}}));
 assert.match(emptyFailure,/No video footage was captured/);assert.doesNotMatch(emptyFailure,/still shows earlier work|continuation/);
 assert.match(recordingViewMessage(snapshot({items:[{...old,partial:true}],status:{state:'saved',attempt:'old'}})),/partial/);
 assert.match(recordingViewMessage(snapshot({status:{state:'capturing',attempt:'old',at}}),Date.parse(at)+60000),/stopped reporting/);
 assert.equal(applicationRecordingTimeline(snapshot({items:[]})),null);
});
test('timeline sorts checkpoints, avoids duplicate full videos and labels missing footage',()=>{
 const split={...old,parts:[{part:1,duration:3},{part:0,duration:2}],duration:5};
 assert.deepEqual(applicationRecordingTimeline(snapshot({items:[split]})).parts.map(part=>part.part),[0,1]);
 assert.equal(applicationRecordingTimeline(snapshot({items:[{...split,parts:[{part:null,duration:5,size:50},...split.parts]}]})).duration,5);
 assert.equal(applicationRecordingTimeline(snapshot({items:[{...split,parts:[{part:1,duration:3}]}]})).partial,true);
 assert.throws(()=>applicationRecordingTimeline(snapshot({nextCursor:'more'})),/limit/);
 assert.throws(()=>applicationRecordingTimeline(snapshot({items:[{...old,size:48_000_001}]})),/limit/);
 assert.throws(()=>applicationRecordingTimeline(snapshot({items:[{...old,duration:3601}]})),/limit/);
});
test('employer link prefers direct application, survives missing listing and rejects unsafe links',()=>{
 assert.equal(applicationEmployerLink({sourceUrl:'https://source.example/job'},{applyUrl:'https://employer.example/apply'}),'https://employer.example/apply');
 assert.equal(applicationEmployerLink({sourceUrl:'https://employer.example/job'}),'https://employer.example/job');
 assert.equal(applicationEmployerLink({sourceUrl:'javascript:alert(1)'},{applyUrl:'https://user:pass@example.test/',url:'https://employer.example/job'}),'https://employer.example/job');
 assert.equal(applicationEmployerLink({sourceUrl:'http://employer.example'}),null);
});
