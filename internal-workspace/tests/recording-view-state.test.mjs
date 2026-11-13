import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile} from 'node:fs/promises';
async function module(name){const code=ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const {latestRecordingAttempt,recordingPollDelay,recordingViewMessage}=await module('recording-view-state');
const {applicationEmployerLink}=await module('application-employer-link');
const at='2026-11-13T12:00:00Z',old={attempt:'old',duration:2,startedAt:at,recordedAt:at,partial:false,reason:'',size:100};
const snapshot=overrides=>({items:[old],nextCursor:null,status:{state:'saved',attempt:'old',at,parts:1,partial:false,code:''},applicationStatus:'needs_attention',currentAttempt:'old',applicationUpdatedAt:at,employer:{title:'Fictional role',company:'Fixture',url:'https://employer.example/apply'},...overrides});

test('saving answers and continuing never presents an earlier run as the new recording',()=>{
 assert.equal(latestRecordingAttempt(snapshot()),'old');
 const queued=snapshot({currentAttempt:null,applicationStatus:'queued',status:null});
 assert.equal(latestRecordingAttempt(queued),'');assert.match(recordingViewMessage(queued),/Waiting.*latest attempt/);
 const processing=snapshot({currentAttempt:'new',applicationStatus:'processing',status:null});
 assert.equal(latestRecordingAttempt(processing),'new');assert.equal(processing.items.find(item=>item.attempt===latestRecordingAttempt(processing)),undefined);
 assert.match(recordingViewMessage(processing),/Waiting for footage/);
 const final=snapshot({currentAttempt:'new',applicationStatus:'uncertain',items:[{...old,attempt:'new',duration:80},old],status:{state:'saved',attempt:'new',at,parts:9,partial:false,code:''}});
 assert.equal(latestRecordingAttempt(final),'new');assert.match(recordingViewMessage(final),/saved and ready/);assert.equal(final.applicationStatus,'uncertain');assert.equal(final.items.length,2);
});
test('polling continues after saved footage so later attempts and delayed uploads are discovered',()=>{
 assert.equal(recordingPollDelay(snapshot()),15000);
 for(const applicationStatus of ['queued','processing'])assert.equal(recordingPollDelay(snapshot({applicationStatus})),5000);
 assert.equal(recordingPollDelay(snapshot({applicationStatus:'uncertain',status:{state:'upload_pending'}})),5000);
 assert.equal(recordingPollDelay(snapshot({applicationStatus:'applied'})),15000);
});
test('late or failed footage remains separate from submission and old status is ignored',()=>{
 assert.match(recordingViewMessage(snapshot({currentAttempt:'new',applicationStatus:'uncertain'})),/No recording.*latest attempt/);
 assert.match(recordingViewMessage(snapshot({status:{state:'upload_pending',attempt:'old'}})),/uploading.*never apply again/);
 assert.match(recordingViewMessage(snapshot({status:{state:'failed',attempt:'old',code:'no_frames'}})),/No browser frames/);
 assert.match(recordingViewMessage(snapshot({items:[{...old,partial:true}],status:{state:'saved',attempt:'old'}})),/partial/);
 assert.match(recordingViewMessage(snapshot({status:{state:'capturing',attempt:'old',at}}),Date.parse(at)+60000),/stopped reporting/);
 assert.equal(latestRecordingAttempt(snapshot({currentAttempt:null,status:null})),'old');
});
test('employer link prefers direct application, survives missing listing and rejects unsafe links',()=>{
 assert.equal(applicationEmployerLink({sourceUrl:'https://source.example/job'},{applyUrl:'https://employer.example/apply'}),'https://employer.example/apply');
 assert.equal(applicationEmployerLink({sourceUrl:'https://employer.example/job'}),'https://employer.example/job');
 assert.equal(applicationEmployerLink({sourceUrl:'javascript:alert(1)'},{applyUrl:'https://user:pass@example.test/',url:'https://employer.example/job'}),'https://employer.example/job');
 assert.equal(applicationEmployerLink({sourceUrl:'http://employer.example'}),null);
});
