import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/handoff-tests';await mkdir(dir,{recursive:true});
for(const name of ['application-live-state','manual-submission','verification-handoff','application-progress','verification-question','verification-handoff','employer-location-choices','application-form-questions','application-question-choices','employer-questions','features','candidate-facts','cover-letter','cyber-domain'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {currentHandoff,handoffCommand,requestCloseReturn}=await import('../'+dir+'/verification-handoff.mjs'),{applicationProgress}=await import('../'+dir+'/application-progress.mjs');
const now=Date.parse('2026-11-13T12:00:00Z');
const app=()=>({id:'app',jobId:'job',status:'processing',reason:'connection_required',sourceUrl:'https://fixture.example',cv:{fileId:'cv'},claim:{id:'claim',at:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString()},verificationHandoff:{id:'handoff',claimId:'claim',turn:1,state:'waiting',kind:'question',questions:['Which of the following best describes you?'],challengeHosts:[],approvedHosts:[],at:new Date(now).toISOString(),expiresAt:new Date(now+240000).toISOString()}});
test('open and resume operate only on the same still-active browser claim',()=>{const a=app();assert.equal(currentHandoff(a,now).id,'handoff');assert.throws(()=>handoffCommand(a,'wrong','open',[],now),/unavailable/);assert.throws(()=>handoffCommand(a,'handoff','resume',[],now),/Open the exact/);handoffCommand(a,'handoff','open',[],now);assert.equal(a.verificationHandoff.state,'opening');a.verificationHandoff.state='opened';handoffCommand(a,'handoff','resume',[],now);assert.equal(a.verificationHandoff.state,'resuming');assert.equal(a.status,'processing');assert.equal(a.cv.fileId,'cv');assert.equal(a.claim.id,'claim');});
test('stale, terminal, foreign-claim and expired handoffs never restart an application',()=>{for(const change of [{status:'uncertain'},{status:'applied'},{claim:{id:'other',expiresAt:new Date(now+600000).toISOString()}}]){const a={...app(),...change};assert.equal(currentHandoff(a,now),null);assert.throws(()=>handoffCommand(a,'handoff','open',[],now),/unavailable/);}const a=app();assert.equal(currentHandoff(a,now+240001),null);});
test('handoff excludes broad verifications and never opens verification-service destinations',()=>{for(const changes of [{kind:'challenge'},{questions:['Are you human?']},{questions:[]},{challengeHosts:['www.google.com']},{approvedHosts:['www.google.com']}]){const a=app();Object.assign(a.verificationHandoff,changes);assert.equal(currentHandoff(a,now),null);assert.throws(()=>handoffCommand(a,'handoff','open',[],now),/unavailable/);}assert.throws(()=>handoffCommand(app(),'handoff','open',['www.google.com'],now),/does not grant/);});
test('cancel is terminal and cannot be used to queue or resume the same form again',()=>{const a=app();handoffCommand(a,'handoff','cancel',[],now);assert.equal(a.verificationHandoff.state,'cancelled');assert.throws(()=>handoffCommand(a,'handoff','open',[],now),/no longer waiting/);assert.equal(a.status,'processing');});
test('progress truthfully identifies the paused verification without claiming delivery',()=>{const a=app(),p=applicationProgress(a,now);assert.equal(p.label,'Verification paused');assert.equal(p.canQueue,false);assert.equal(p.steps[2].state,'pending');a.verificationHandoff.state='resuming';assert.equal(applicationProgress(a,now).label,'Resuming after verification');});


test('separate reCAPTCHA handoff requires exact session-scoped provider consent and never allows generic challenges',()=>{const a=app();Object.assign(a.verificationHandoff,{kind:'recaptcha',phase:'after_submit',questions:['Complete the employer reCAPTCHA in this browser.'],challengeHosts:['www.google.com','www.gstatic.com']});assert.equal(currentHandoff(a,now).phase,'after_submit');for(const hosts of [[],['www.google.com'],['www.google.com','www.gstatic.com','evil.test']])assert.throws(()=>handoffCommand(a,'handoff','open',hosts,now),/Approve exactly/);handoffCommand(a,'handoff','open',['www.gstatic.com','www.google.com'],now);assert.equal(a.verificationHandoff.state,'opening');assert.equal(a.status,'processing');assert.equal(a.claim.id,'claim');a.verificationHandoff.challengeHosts.push('evil.test');assert.equal(currentHandoff(a,now),null);});

test('persistent human/AI handoff survives long waits without permitting other verification scopes',()=>{
 const a=app();a.verificationHandoff.persistent=true;const later=now+48*3600000;
 assert.equal(currentHandoff(a,later).id,'handoff');handoffCommand(a,'handoff','open',[],later);a.verificationHandoff.state='opened';handoffCommand(a,'handoff','resume',[],later);assert.equal(a.verificationHandoff.state,'resuming');
 const p=applicationProgress(a,later);assert.equal(p.label,'Resuming after verification');assert.equal(p.canQueue,false);
 for(const change of [{claimId:'other'},{questions:['Salary expectation?']},{challengeHosts:['www.google.com']},{kind:'recaptcha'}]){const b=app();Object.assign(b.verificationHandoff,{persistent:true},change);assert.equal(currentHandoff(b,later),null);}
});

const {applicationLiveState}=await import('../'+dir+'/application-live-state.mjs');
test('ordinary employer-answer pauses keep the live viewer waiting without opening a browser or changing a claim',()=>{
 const a=app();delete a.verificationHandoff;a.status='needs_attention';const before=structuredClone(a);
 const waiting=applicationLiveState(a,now);assert.equal(waiting.active,false);assert.equal(waiting.control,'needs_input');
 assert.match(waiting.message,/Agent has requested user input/);assert.match(waiting.message,/Applications.*approve and save/);assert.doesNotMatch(waiting.message,/exact agent browser|session ended/);assert.deepEqual(a,before);
 a.status='queued';assert.equal(applicationLiveState(a,now).active,true);assert.equal(applicationLiveState(a,now).control,'queued');
 a.status='processing';assert.equal(applicationLiveState(a,now).control,'agent');assert.equal(a.claim.id,before.claim.id);
 for(const status of ['applied','uncertain','failed']){a.status=status;assert.equal(applicationLiveState(a,now).active,false);assert.equal(applicationLiveState(a,now).control,'ended');}
});
test('live state preserves a long-lived manual form and shows control without changing outcome',()=>{
 const a=app();Object.assign(a.verificationHandoff,{kind:'input',persistent:true,questions:['What motivates you?']});const later=now+48*3600000;
 assert.equal(currentHandoff(a,later).id,'handoff');assert.equal(applicationLiveState(a,later).control,'needs_input');
 handoffCommand(a,'handoff','open',[],later);a.verificationHandoff.state='opened';assert.equal(applicationLiveState(a,later).control,'manual');
 handoffCommand(a,'handoff','resume',[],later);assert.equal(applicationLiveState(a,later).control,'resuming');assert.equal(a.status,'processing');assert.equal(a.claim.id,'claim');
 a.verificationHandoff.state='resumed';assert.equal(applicationLiveState(a,now).control,'agent');a.status='applied';assert.equal(applicationLiveState(a,now).active,false);
});
test('private CAPTCHA video is excluded, and general input cannot grant new hosts or cover passwords',()=>{
 const a=app();Object.assign(a.verificationHandoff,{kind:'recaptcha',questions:['Complete the employer reCAPTCHA in this browser.'],challengeHosts:['www.google.com']});assert.equal(applicationLiveState(a,now).privateCheck,true);
 for(const question of ['Password','Security code','reCAPTCHA','One time code']){const b=app();Object.assign(b.verificationHandoff,{kind:'input',persistent:true,questions:[question]});assert.equal(currentHandoff(b,now),null);}
 const b=app();Object.assign(b.verificationHandoff,{kind:'input',persistent:true,questions:['Motivation?']});assert.throws(()=>handoffCommand(b,'handoff','open',['www.google.com'],now),/does not grant/);
});


test('manual close returns only an opted-in persistent opened identity session, idempotently',()=>{
 const a=app();Object.assign(a.verificationHandoff,{persistent:true,closeReturnsControl:true,state:'opened'});const before=structuredClone(a);
 requestCloseReturn(a,'handoff',now);assert.equal(a.verificationHandoff.state,'resuming');requestCloseReturn(a,'handoff',now);
 assert.equal(a.claim.id,before.claim.id);assert.deepEqual(a.cv,before.cv);assert.equal(a.status,'processing');assert.deepEqual(a.verificationHandoff.approvedHosts,[]);
 for(const change of [{kind:'input',questions:['Motivation?']},{kind:'recaptcha',questions:['Complete the employer reCAPTCHA in this browser.']},{closeReturnsControl:undefined},{persistent:undefined},{state:'waiting'},{state:'cancelled'},{state:'resumed'},{claimId:'other'}]){const b=structuredClone(before);Object.assign(b.verificationHandoff,change);assert.throws(()=>requestCloseReturn(b,'handoff',now));}
 assert.throws(()=>requestCloseReturn(before,'wrong',now));
});
