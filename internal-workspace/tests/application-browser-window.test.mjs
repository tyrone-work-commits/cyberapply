import{test}from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import ts from'typescript';import{mkdir,readFile,writeFile}from'node:fs/promises';import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';
const dir='.sites-runtime/browser-window-tests';await mkdir(dir,{recursive:true});await writeFile(`${dir}/cyber-domain.mjs`,"export class DomainError extends Error{constructor(message,status=400){super(message);this.status=status;}}");
const code=ts.transpileModule(await readFile('lib/application-browser-window.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await writeFile(`${dir}/application-browser-window.mjs`,code);
const{browserWindowState:status,getBrowserWindow:get,requestBrowserWindow:open,updateBrowserWindow:update}=await import('../'+dir+'/application-browser-window.mjs');
const sql=new DatabaseSync(':memory:');sql.exec(await readFile('drizzle/0005_application_browser_windows.sql','utf8'));
const db={prepare(q){let args=[];return{bind(...v){args=v;return this;},async first(){return sql.prepare(q).get(...args)||null;},async run(){return{meta:{changes:Number(sql.prepare(q).run(...args).changes)}};}};}};
const now=1800000000000,app=(id='one',claim='claim-one')=>({id,status:'processing',claim:{id:claim}}),ready=async(owner,item,session,at=now)=>update(db,owner,item,{sessionId:session,event:'ready'},at);

test('same-request/claim session commands are owner isolated and never alter the application',async()=>{
 const a=app(),b=app(),before=structuredClone(a);await ready('a',a,'session-a');await ready('b',b,'session-b');
 assert.equal(status('a',a,await get(db,'b','one'),now).available,false);
 await assert.rejects(open(db,'a',a,'session-b','claim-one',now),/not available/);
 const requested=await open(db,'a',a,'session-a','claim-one',now);assert.equal(requested.opening,true);
 assert.equal((await get(db,'b','one')).open_id,null);assert.deepEqual(a,before);
});
test('opening is acknowledged for the exact nonce once, without navigation/queue/submit state',async()=>{
 const item=app('two');await ready('a',item,'session-two');await open(db,'a',item,'session-two','claim-one',now);
 const command=await update(db,'a',item,{sessionId:'session-two',event:'poll'},now+1);assert.ok(command.openId);
 await update(db,'a',item,{sessionId:'session-two',event:'poll',openedId:command.openId},now+2);
 assert.equal(status('a',item,await get(db,'a','two'),now+2).opened,true);
 assert.equal((await update(db,'a',item,{sessionId:'session-two',event:'poll',openedId:command.openId},now+3)).openId,null);
 assert.equal(item.status,'processing');assert.equal(item.result,undefined);
});
test('closed, stale, wrong-claim and terminal application sessions cannot be reopened',async()=>{
 const item=app('three');await ready('a',item,'session-three');await assert.rejects(open(db,'a',item,'session-three','claim-one',now+20001),/not available/);
 await assert.rejects(open(db,'a',{...item,claim:{id:'new-claim'}},'session-three','new-claim',now),/not available/);
 for(const state of ['queued','needs_attention','uncertain','applied'])assert.equal(status('a',{...item,status:state},await get(db,'a','three'),now).available,false);
 await update(db,'a',item,{sessionId:'session-three',event:'closed'},now+1);await assert.rejects(open(db,'a',item,'session-three','claim-one',now+2),/not available/);
});
test('a concurrent browser cannot take over a fresh session or acknowledge another command',async()=>{
 const item=app('four');await ready('a',item,'session-four');await assert.rejects(ready('a',item,'replacement',now+1),/no longer active/);
 await open(db,'a',item,'session-four','claim-one',now+2);const pending=(await get(db,'a','four')).open_id;
 const reply=await update(db,'a',item,{sessionId:'session-four',event:'poll',openedId:'foreign-nonce'},now+3);assert.equal(reply.openId,pending);
 const newItem=app('four','new-claim');await ready('a',newItem,'new-session',now+4);await assert.rejects(update(db,'a',item,{sessionId:'session-four',event:'poll'},now+5),/no longer active/);
});
test('focus errors are honest and reopening requests a new nonce; cleanup is owner scoped',async()=>{
 const item=app('five');await ready('a',item,'session-five');await open(db,'a',item,'session-five','claim-one',now);let command=(await get(db,'a','five')).open_id;
 await update(db,'a',item,{sessionId:'session-five',event:'poll',openedId:command,error:'window_unavailable'},now+1);assert.equal(status('a',item,await get(db,'a','five'),now+1).error,'window_unavailable');
 await open(db,'a',item,'session-five','claim-one',now+2);assert.notEqual((await get(db,'a','five')).open_id,command);
 sql.prepare('DELETE FROM cyber_application_browser_windows WHERE owner_id=? AND request_id IN (SELECT value FROM json_each(?))').run('a','["one"]');assert.equal(await get(db,'a','one'),null);assert.ok(await get(db,'b','one'));
});
await writeFile(`${dir}/button.mjs`,ts.transpileModule(await readFile('app/application-browser-button.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
const{ApplicationBrowserButton}=await import('../'+dir+'/button.mjs');
test('Open employer application opens the exact HTTPS employer page in an independent new tab',()=>{
 const url='https://employer.example/jobs/123?source=board#apply';
 const html=renderToStaticMarkup(createElement(ApplicationBrowserButton,{url}));
 assert.match(html,/Open employer application/);assert.ok(html.includes('href="'+url+'"'));assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/opens in a new tab/);assert.doesNotMatch(html,/<button|browser-window/);
 for(const invalid of ['javascript:alert(1)','http://employer.example/form','https://user:secret@employer.example/form','not a URL'])assert.equal(renderToStaticMarkup(createElement(ApplicationBrowserButton,{url:invalid})), '');
});


test('legacy window commands cannot bypass the manual-submit checkbox gate',async()=>{
 const item=app('manual-gate');await ready('a',item,'manual-session');await open(db,'a',item,'manual-session','claim-one',now);
 item.manualSubmission={id:'manual-one',claimId:'claim-one',state:'ready',challengeHosts:[],approvedHosts:[]};
 assert.equal(status('a',item,await get(db,'a',item.id),now).available,false);
 await assert.rejects(open(db,'a',item,'manual-session','claim-one',now),/not available/);
 assert.equal((await update(db,'a',item,{sessionId:'manual-session',event:'poll'},now)).openId,null);
});
