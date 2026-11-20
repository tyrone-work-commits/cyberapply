import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/desktop-notice-tests';await mkdir(dir,{recursive:true});
for(const name of ['desktop-notices','manual-submission','verification-handoff','cyber-domain','candidate-facts','cover-letter','application-form-questions','application-question-choices','employer-location-choices','employer-questions','verification-question','features'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {desktopNotices}=await import('../'+dir+'/desktop-notices.mjs');
const at='2026-11-20T12:00:00Z',now=Date.parse(at),claim={id:'claim',at,expiresAt:'2026-11-20T13:00:00Z'};
const request=(id='one')=>({id,jobId:'job',status:'needs_attention',at,claim,cv:{secret:'never include'},report:{answers:[{value:'PRIVATE ANSWER'}]}});
const state=applications=>({jobs:[{id:'job',company:'Fictional employer',title:'Security Analyst'}],applications,profile:{resumeText:'PRIVATE CV'}});
test('input notices are stable, per request/claim, bounded metadata and never include applicant facts',()=>{
 const s=state([request(),request('two')]),before=structuredClone(s),rows=desktopNotices(s,now);
 assert.equal(rows.length,2);assert.notEqual(rows[0].key,rows[1].key);assert.equal(rows[0].kind,'input');assert.equal(rows[0].role,'Security Analyst');assert.deepEqual(rows,desktopNotices(s,now+20000));assert.deepEqual(s,before);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|resumeText|"answers"|secret/);
 s.applications[0].claim={...claim,id:'next-claim'};assert.notEqual(desktopNotices(s,now)[0].key,rows[0].key);
});
test('manual-submit alerts have priority and validation errors create a distinct human-action event',()=>{
 const a={...request(),status:'processing',manualSubmission:{id:'manual',claimId:'claim',state:'ready',at,updatedAt:at,challengeHosts:[],approvedHosts:[]}};
 const ready=desktopNotices(state([a]),now)[0];assert.equal(ready.kind,'submit');a.manualSubmission.state='needs_submit';const again=desktopNotices(state([a]),now)[0];assert.equal(again.kind,'submit');assert.notEqual(again.key,ready.key);
 for(const status of ['applied','uncertain','queued','failed'])assert.deepEqual(desktopNotices(state([{...a,status}]),now),[]);
});
test('same-browser verification alerts do not repeat on opening and stop when resuming',()=>{
 const a={...request(),status:'processing',verificationHandoff:{id:'handoff',claimId:'claim',kind:'question',state:'waiting',questions:['Which of the following best describes you?'],challengeHosts:[],approvedHosts:[],at,expiresAt:'2026-11-20T12:05:00Z'}};
 const waiting=desktopNotices(state([a]),now)[0];assert.equal(waiting.kind,'input');a.verificationHandoff.state='opened';assert.equal(desktopNotices(state([a]),now)[0].key,waiting.key);a.verificationHandoff.state='resuming';assert.deepEqual(desktopNotices(state([a]),now),[]);
});
test('old terminal applications and expired verification sessions do not alert; multiple applications are bounded',()=>{
 const rows=Array.from({length:110},(_,i)=>request(String(i)));assert.equal(desktopNotices(state(rows),now).length,100);
 for(const status of ['queued','processing','applied','uncertain','failed'])assert.deepEqual(desktopNotices(state([{...request(),status}]),now),[]);
});
