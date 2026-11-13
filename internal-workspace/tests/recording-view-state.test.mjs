import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile} from 'node:fs/promises';
async function module(name){const code=ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const {applicationRecordingTimeline,recordingPollDelay,recordingViewMessage}=await module('recording-view-state');
const {applicationEmployerLink}=await module('application-employer-link');
const at='2026-11-13T12:00:00Z',old={attempt:'old',duration:2,startedAt:at,recordedAt:at,partial:false,reason:'',size:100};
const snapshot=overrides=>({items:[old],nextCursor:null,status:{state:'saved',attempt:'old',at,parts:1,partial:false,code:''},applicationStatus:'needs_attention',currentAttempt:'old',applicationUpdatedAt:at,employer:{title:'Fictional role',company:'Fixture',url:'https://employer.example/apply'},...overrides});

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
});
test('late or failed footage remains separate from submission and old status is ignored',()=>{
 assert.match(recordingViewMessage(snapshot({currentAttempt:'new',applicationStatus:'uncertain'})),/Showing work recorded so far/);
 assert.match(recordingViewMessage(snapshot({status:{state:'upload_pending',attempt:'old'}})),/uploading.*never apply again/);
 assert.match(recordingViewMessage(snapshot({status:{state:'failed',attempt:'old',code:'no_frames'}})),/No new frames/);
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
