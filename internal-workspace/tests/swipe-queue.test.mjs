import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('.sites-runtime/swipe-tests',{recursive:true});
for(const name of ['candidate-facts','cyber-domain','swipe-queue'])await writeFile(`.sites-runtime/swipe-tests/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("from './cyber-domain'","from './cyber-domain.mjs'").replace("from './candidate-facts'","from './candidate-facts.mjs'"));
const {SwipeQueue}=await import('../.sites-runtime/swipe-tests/swipe-queue.mjs');
const {emptyState,reduceAction}=await import('../.sites-runtime/swipe-tests/cyber-domain.mjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const now='2026-10-17T18:00:00.000Z';
function initial(){const state=emptyState('qa@example.test');state.profile={fullName:'Local QA',email:'qa@example.test',skills:['SIEM'],preferredRoles:[],resumeText:'Local QA supplied SIEM facts for local swipe testing.',reviewed:true};state.jobs=['a','b','c'].map(id=>({id,title:`QA ${id}`,company:'Local QA',location:'Remote',workMode:'Remote',url:`https://qa.example.test/${id}`,description:'Local-only fixture for swipe save ordering.',skills:['SIEM'],sample:false,saved:false,disposition:'open',createdAt:now}));return{revision:0,updatedAt:now,state};}
function saved(packet,action){return {...packet,revision:packet.revision+1,state:reduceAction(packet.state,action,'interface',now).state};}
function setup(send,recover){let view,status;const errors=[];const queue=new SwipeQueue({send,recover,change:(p,s)=>{view=p;status=s;},error:m=>errors.push(m)});queue.replace(initial());return{queue,errors,get view(){return view;},get status(){return status;}};}
test('a stalled network does not delay advancing cards; rapid swipes save in revision order',async()=>{
 const gate=deferred(),calls=[];let server=initial();const h=setup(async(base,action)=>{calls.push({base,action});if(calls.length===1)await gate.promise;assert.equal(base.revision,server.revision);server=saved(server,action);return server;},async()=>server);
 h.queue.enqueue({type:'decide_job',jobId:'a',decision:'pass'});
 assert.equal(h.view.state.jobs[0].disposition,'passed');assert.equal(h.status.pending,1);assert.equal(server.revision,0);
 h.queue.enqueue({type:'decide_job',jobId:'b',decision:'apply'});
 assert.equal(h.view.state.jobs[1].disposition,'apply_requested');assert.equal(h.status.pending,2);assert.equal(calls.length,1);
 gate.resolve();await tick();assert.equal(h.status.pending,0);assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.base.revision),[0,1]);assert.equal(server.state.applications.length,1);assert.equal(h.view.revision,2);
});
test('Undo responds before the first save completes and restores an unsent Apply without orphan materials',async()=>{
 const gate=deferred();let server=initial(),calls=0;const h=setup(async(base,action)=>{if(!calls++)await gate.promise;server=saved(server,action);return server;},async()=>server);
 h.queue.enqueue({type:'decide_job',jobId:'a',decision:'apply'});const decision=h.view.state.lastDecision;
 h.queue.enqueue({type:'undo_decision',jobId:'a',decisionId:decision.operationId});
 assert.equal(h.view.state.jobs[0].disposition,'open');assert.equal(h.view.state.applications.length,0);assert.equal(h.view.state.drafts.length,0);assert.equal(server.revision,0);
 gate.resolve();await tick();assert.equal(server.state.jobs[0].disposition,'open');assert.equal(server.state.applications.length,0);assert.equal(server.state.drafts.length,0);assert.equal(h.status.pending,0);
});
test('lost responses are reconciled by operation ID without resending or duplicating requests',async()=>{
 let server=initial(),calls=0,reads=0;const h=setup(async(base,action)=>{calls++;server=saved(server,action);throw Error('Response lost');},async()=>{reads++;return server;});
 h.queue.enqueue({type:'decide_job',jobId:'a',decision:'apply'});await tick();assert.equal(calls,1);assert.equal(reads,1);assert.equal(h.status.pending,0);assert.equal(h.errors.length,0);assert.equal(h.view.state.applications.length,1);
});
test('failed saves restore the latest server cards and discard later unsaved choices',async()=>{
 const gate=deferred();let calls=0;const server=initial();const h=setup(async()=>{calls++;await gate.promise;throw Error('Save failed');},async()=>server);
 h.queue.enqueue({type:'decide_job',jobId:'a',decision:'pass'});h.queue.enqueue({type:'decide_job',jobId:'b',decision:'apply'});gate.resolve();await tick();
 assert.equal(calls,1);assert.ok(h.view.state.jobs.every(j=>j.disposition==='open'));assert.equal(h.status.pending,0);assert.match(h.errors[0],/latest saved state/);
});
test('unconfirmed saves block further choices until an explicit successful reload',async()=>{
 const h=setup(async()=>{throw Error('Offline');},async()=>{throw Error('Offline');});h.queue.enqueue({type:'decide_job',jobId:'a',decision:'pass'});await tick();assert.equal(h.status.blocked,true);assert.equal(h.view.state.jobs[0].disposition,'open');assert.throws(()=>h.queue.enqueue({type:'decide_job',jobId:'b',decision:'pass'}),/Reload/);h.queue.replace(initial());assert.equal(h.status.blocked,false);
});
test('rapid duplicate clicks create one pending choice, and replacement cannot race an active save',async()=>{
 const gate=deferred();let count=0;const h=setup(async(base,action)=>{count++;await gate.promise;return saved(base,action);},async()=>initial());h.queue.enqueue({type:'decide_job',jobId:'a',decision:'pass'});h.queue.enqueue({type:'decide_job',jobId:'a',decision:'pass'});assert.equal(h.status.pending,1);assert.throws(()=>h.queue.replace(initial()),/Wait/);gate.resolve();await tick();assert.equal(count,1);
});
test('unreviewed Apply appears immediately as an unsent request while saving',async()=>{
 const gate=deferred();const h=setup(async(base,action)=>{await gate.promise;return saved(base,action);},async()=>initial());const packet=initial();packet.state.profile.reviewed=false;h.queue.replace(packet);h.queue.enqueue({type:'decide_job',jobId:'a',decision:'apply'});assert.equal(h.status.pending,1);assert.equal(h.view.state.jobs[0].disposition,'apply_requested');assert.equal(h.view.state.applications[0].reason,'cv_required');gate.resolve();await tick();assert.equal(h.status.pending,0);
});


test('bookmark saves and Undo change the deck immediately while the first response is stalled',async()=>{
 const gate=deferred();let server=initial(),calls=0;const h=setup(async(base,action)=>{if(!calls++)await gate.promise;assert.equal(base.revision,server.revision);server=saved(server,action);return server;},async()=>server);
 h.queue.enqueue({type:'save_job',jobId:'a',saved:true});h.queue.enqueue({type:'save_job',jobId:'a',saved:true});
 assert.equal(h.view.state.jobs.filter(j=>j.disposition==='open'&&!j.saved)[0].id,'b');assert.equal(h.status.pending,1);assert.equal(server.state.jobs[0].saved,false);
 const last=h.view.state.lastDecision;h.queue.enqueue({type:'undo_decision',jobId:'a',decisionId:last.operationId});assert.equal(h.view.state.jobs[0].saved,false);assert.equal(h.status.pending,2);
 gate.resolve();await tick();assert.equal(h.status.pending,0);assert.equal(server.state.jobs[0].saved,false);assert.equal(server.revision,2);
});
test('rapid bookmark, reject and unsave choices serialize without hiding newer choices',async()=>{
 const gate=deferred();let server=initial(),calls=0;const h=setup(async(base,action)=>{if(!calls++)await gate.promise;assert.equal(base.revision,server.revision);server=saved(server,action);return server;},async()=>server);
 h.queue.enqueue({type:'save_job',jobId:'a',saved:true});h.queue.enqueue({type:'decide_job',jobId:'b',decision:'pass'});h.queue.enqueue({type:'save_job',jobId:'a',saved:false});
 assert.equal(h.view.state.jobs[0].saved,false);assert.equal(h.view.state.jobs[1].disposition,'passed');gate.resolve();await tick();assert.equal(server.state.jobs[0].saved,false);assert.equal(server.state.jobs[1].disposition,'passed');assert.equal(server.revision,3);
});
test('a lost bookmark response reconciles once and a failed bookmark rolls back',async()=>{
 let server=initial(),calls=0;const h=setup(async(base,action)=>{calls++;server=saved(server,action);throw Error('Lost response');},async()=>server);h.queue.enqueue({type:'save_job',jobId:'a',saved:true});await tick();assert.equal(h.view.state.jobs[0].saved,true);assert.equal(h.errors.length,0);assert.equal(calls,1);
 const failed=setup(async()=>{throw Error('Save failed');},async()=>initial());failed.queue.enqueue({type:'save_job',jobId:'a',saved:true});await tick();assert.equal(failed.view.state.jobs[0].saved,false);assert.equal(failed.status.pending,0);assert.match(failed.errors[0],/latest saved state/);
});
