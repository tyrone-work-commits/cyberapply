import{test}from'node:test';import assert from'node:assert/strict';import ts from'typescript';import{mkdir,readFile,writeFile}from'node:fs/promises';
const dir='.sites-runtime/manual-submit-controls';await mkdir(dir,{recursive:true});await writeFile(`${dir}/cyber-domain.mjs`,"export class DomainError extends Error{constructor(message,status){super(message);this.status=status;}}");
await writeFile(`${dir}/manual-submission.mjs`,ts.transpileModule(await readFile('lib/manual-submission.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./cyber-domain'","'./cyber-domain.mjs'"));
const{manualCommand,manualSession,manualDisplaySession,closedBeforeSubmit,recoverManualSubmission}=await import('../'+dir+'/manual-submission.mjs');
const app=(hosts=[])=>({status:'processing',claim:{id:'claim'},manualSubmission:{id:'manual',claimId:'claim',state:'ready',challengeHosts:hosts,approvedHosts:[]}});
test('opening always requires explicit checkbox confirmation, including without reCAPTCHA',()=>{
 for(const hosts of [[],['www.google.com']]){const item=app(hosts),before=structuredClone(item);for(const confirm of [undefined,false]){assert.throws(()=>manualCommand(item,'manual','open',hosts,confirm),/checkbox/);assert.deepEqual(item,before);}assert.equal(manualCommand(item,'manual','open',hosts,true).openRequested,true);}
});
test('the exact pending host list must be approved and failed commands do not mutate state',()=>{
 const item=app(['www.google.com','www.gstatic.com']),before=structuredClone(item);
 for(const hosts of [[],['www.google.com'],['evil.test']]){assert.throws(()=>manualCommand(item,'manual','open',hosts,true),/hosts/);assert.deepEqual(item,before);}
 assert.deepEqual(manualCommand(item,'manual','open',before.manualSubmission.challengeHosts,true).approvedHosts,before.manualSubmission.challengeHosts);
});
test('cancelling needs no checkbox, and stale or cancelled sessions cannot be opened',()=>{
 const item=app();assert.throws(()=>manualCommand(item,'other','open',[],true),/unavailable/);assert.equal(manualCommand(item,'manual','cancel').state,'cancel_requested');assert.throws(()=>manualCommand(item,'manual','open',[],true),/Cancellation/);assert.equal(item.manualSubmission.openRequested,false);
});

const closed=()=>({...app(['www.google.com']),id:'same-request',cv:{fileId:'original-cv'},confirmedAnswers:[{question:'Travel?',value:'25-50%'}],status:'uncertain',manualSubmission:{...app(['www.google.com']).manualSubmission,state:'cancelled'},report:{journey:{version:1,continue_click_attempts:0,submit_click_attempts:0,possible_delivery:false,manual_submit_observed:false,human_submit_observed:0},manual_submission:{policy:'user_final_submit',human_submit_observed:0}}});
test('known-unsent legacy closure retains Ready without queueing or discarding CV/answers',()=>{
 const item=closed(),before=structuredClone(item);assert.equal(closedBeforeSubmit(item),true);assert.equal(manualDisplaySession(item).state,'closed_before_submit');assert.equal(manualSession(item),null);assert.deepEqual(item,before);
 assert.throws(()=>manualCommand(item,'manual','open',['www.google.com'],true),/unavailable/);
 for(const extra of [{open:false,closed:true},{open:true,closed:false}])assert.throws(()=>recoverManualSubmission(item,'manual',['www.google.com'],extra.open,extra.closed),/Confirm/);
 assert.deepEqual(item,before);assert.throws(()=>recoverManualSubmission(item,'manual',[],true,true),/hosts/);
 const recovered=recoverManualSubmission(item,'manual',['www.google.com'],true,true);assert.equal(recovered.state,'reopening');assert.equal(item.status,'queued');assert.equal(item.id,before.id);assert.deepEqual(item.cv,before.cv);assert.deepEqual(item.confirmedAnswers,before.confirmedAnswers);assert.equal(manualSession(item),null);
 assert.throws(()=>recoverManualSubmission(item,'manual',['www.google.com'],true,true),/No verified/);
});
test('no recovery for Continue, human Submit, delivery, receipts, applied or missing evidence',()=>{
 for(const [key,value] of [['continue_click_attempts',1],['submit_click_attempts',1],['possible_delivery',true],['manual_submit_observed',true],['human_submit_observed',1],['human_submit_observed',undefined]]){const item=closed();item.report.journey[key]=value;assert.equal(closedBeforeSubmit(item),false,key);assert.equal(manualDisplaySession(item),null);assert.throws(()=>recoverManualSubmission(item,'manual',['www.google.com'],true,true),/No verified/);}
 for(const patch of [{status:'applied'},{result:{receipt:'received'}},{result:{evidence:{url:'https://example.test',text:'Thanks'}}},{claim:{id:'different'}}])assert.equal(manualDisplaySession({...closed(),...patch}),null);
 const item=closed();item.report.manual_submission.recovery_cancelled=true;assert.equal(manualDisplaySession(item),null);
});
