import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('.sites-runtime/application-progress-tests',{recursive:true});
const code=ts.transpileModule(await readFile('lib/application-progress.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
await writeFile('.sites-runtime/application-progress-tests/application-progress.mjs',code);
const {applicationProgress}=await import('../.sites-runtime/application-progress-tests/application-progress.mjs');
const at='2026-10-28T12:00:00.000Z',now=Date.parse(at);
function request(overrides={}){return {id:'request-test',jobId:'job',draftId:'draft',draftVersion:1,text:'Original draft',candidate:{fullName:'Test Candidate',email:'test@example.test',skills:[],preferredRoles:[],resumeText:'CV snapshot',reviewed:false},cv:{fileId:'original-cv',name:'original.pdf',type:'application/pdf',size:1000},at,status:'needs_action',reason:'connection_required',sourceUrl:'https://employer.example/job',...overrides};}

test('queued means waiting for the runner, without claiming work has started',()=>{
 const result=applicationProgress(request({status:'queued'}),now);
 assert.equal(result.group,'in_progress');assert.equal(result.label,'Queued');
 assert.match(result.description,/Waiting for your browser runner/);
 assert.equal(result.steps[1].state,'pending');assert.equal(result.steps[2].state,'pending');
 assert.deepEqual(result.events,[{label:'Apply requested',at}]);assert.equal(result.canQueue,false);
});
test('a current claim shows working; an expired or missing claim requires checking without a retry',()=>{
 const item=request({status:'processing',claim:{id:'claim',at,expiresAt:'2026-10-28T12:15:00.000Z'}});
 const active=applicationProgress(item,now);assert.equal(active.label,'Agent working');assert.equal(active.group,'in_progress');assert.equal(active.steps[1].state,'current');
 for(const partial of [{claim:undefined},{claim:{...item.claim,expiresAt:'not-a-date'}},{claim:{...item.claim,expiresAt:at}}]){
  const stale=applicationProgress({...item,...partial},now);assert.equal(stale.group,'check_outcome');assert.equal(stale.canQueue,false);assert.match(stale.description,/stopped reporting/);
 }
});
test('an Applied flag without confirmation is never presented as confirmed',()=>{
 for(const result of [undefined,{at,message:'Submit clicked'},{at,message:'Unknown',receipt:'   ',evidence:{url:'javascript:alert(1)',text:'Thanks'}}]){
  const progress=applicationProgress(request({status:'applied',result}),now);assert.equal(progress.group,'check_outcome');assert.equal(progress.canQueue,false);assert.notEqual(progress.label,'Applied');assert.notEqual(progress.steps[2].state,'done');
 }
});
test('legacy receipts and explicit employer evidence retain confirmed application history',()=>{
 for(const result of [{at,message:'Confirmed',receipt:'LEGACY-123'},{at,message:'Confirmed',evidence:{url:'https://employer.example/confirmation',text:'Thank you for applying'}}]){
  const progress=applicationProgress(request({status:'applied',result}),now);assert.equal(progress.group,'applied');assert.equal(progress.label,'Applied');assert.ok(progress.steps.every(step=>step.state==='done'));assert.equal(progress.events.at(-1).label,'Employer confirmation recorded');
 }
});
test('an uncertain result cannot be queued even when it contains a receipt-like string',()=>{
 const progress=applicationProgress(request({status:'uncertain',result:{at,message:'Unverified mail',receipt:'Possible receipt'}}),now);assert.equal(progress.group,'check_outcome');assert.equal(progress.canQueue,false);assert.equal(progress.events.at(-1).label,'Outcome needs checking');
});
test('known unsent work can queue only with its original CV and valid material state',()=>{
 for(const status of ['needs_action','needs_attention','failed'])assert.equal(applicationProgress(request({status}),now).canQueue,true);
 for(const overrides of [{cv:undefined},{reason:'cv_required'},{reason:'materials_changed'},{reason:'candidate_review_required'}])assert.equal(applicationProgress(request(overrides),now).canQueue,false);
});
test('displaying the journey never changes captured materials or invents intermediate events',()=>{
 const item=request({status:'needs_attention',claim:{id:'claim',at:'2026-10-28T12:01:00.000Z',expiresAt:'2026-10-28T12:16:00.000Z'},result:{at:'2026-10-28T12:02:00.000Z',message:'Question missing'}}),original=structuredClone(item);
 const progress=applicationProgress(item,now);assert.deepEqual(item,original);assert.equal(item.cv.fileId,'original-cv');
 assert.deepEqual(progress.events.map(event=>event.label),['Apply requested','Agent started','Agent requested your input']);assert.equal(progress.steps[2].state,'pending');
 assert.ok(progress.events.every(event=>!/(research|cover letter|filled|uploaded|submitted)/i.test(event.label)));
});

test('generated drafts are shown as approval needed, not applied',()=>{const progress=applicationProgress(request({status:'needs_attention',report:{unresolved:[{question:'Why this role?',source:'generated',suggested_value:'A draft awaiting review.'}]}}));assert.equal(progress.label,'Approval needed');assert.equal(progress.group,'needs_you');});
