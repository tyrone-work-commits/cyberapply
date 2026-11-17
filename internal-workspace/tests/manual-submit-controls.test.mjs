import{test}from'node:test';import assert from'node:assert/strict';import ts from'typescript';import{mkdir,readFile,writeFile}from'node:fs/promises';
const dir='.sites-runtime/manual-submit-controls';await mkdir(dir,{recursive:true});await writeFile(`${dir}/cyber-domain.mjs`,"export class DomainError extends Error{constructor(message,status){super(message);this.status=status;}}");
await writeFile(`${dir}/manual-submission.mjs`,ts.transpileModule(await readFile('lib/manual-submission.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./cyber-domain'","'./cyber-domain.mjs'"));
const{manualCommand}=await import('../'+dir+'/manual-submission.mjs');
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
