import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile} from 'node:fs/promises';
const source=ts.transpileModule(await readFile('lib/recording-loader.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {RecordingLoader}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const video=()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'video/mp4'}});
test('the default browser fetch retains the global receiver instead of receiving the loader instance',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=function(){assert.equal(this,globalThis);calls++;return Promise.resolve(video());};const loader=new RecordingLoader();await loader.load('private');assert.equal(calls,1);loader.close();}
 finally{globalThis.fetch=original;}
});
test('bounded parallel downloads share in-flight requests across refreshed manifests and retain chronological results',async()=>{
 let active=0,peak=0,calls=0;const release=[];
 const loader=new RecordingLoader(async()=>{calls++;peak=Math.max(peak,++active);await new Promise(resolve=>release.push(resolve));active--;return video();});
 const paths=['3','2','1','0'];loader.retain(paths);const tasks=paths.map(path=>loader.load(path));const duplicate=loader.load('2');
 assert.equal(calls,3);assert.equal(peak,3);release.shift()();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,4);
 while(release.length)release.shift()();const results=await Promise.all(tasks);assert.equal(await duplicate,results[1]);
 assert.equal(await loader.load('2'),results[1]);assert.equal(calls,4);loader.close();
});
test('a stalled request retries once; access errors do not retry',async()=>{
 let calls=0;const loader=new RecordingLoader(async(_,{signal})=>{calls++;if(calls===2)return video();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));},3,10);
 assert.equal((await loader.load('slow')).byteLength,3);assert.equal(calls,2);loader.close();
 let denied=0;const privateLoader=new RecordingLoader(async()=>{denied++;return new Response('Denied',{status:403});});await assert.rejects(privateLoader.load('private'),/private video/);assert.equal(denied,1);privateLoader.close();
});
test('changing applications cancels active and queued private downloads',async()=>{
 const loader=new RecordingLoader(async(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))),1);
 const tasks=[loader.load('first'),loader.load('queued')];loader.close();assert.deepEqual((await Promise.allSettled(tasks)).map(x=>x.status),['rejected','rejected']);
});
test('malformed and oversized bodies are not cached or retried, and replaced fragments are evicted',async()=>{
 let calls=0;const loader=new RecordingLoader(async()=>{calls++;return video();});await loader.load('old');loader.retain(['new']);await loader.load('old');assert.equal(calls,2);loader.close();
 const oversized=new RecordingLoader(async()=>new Response(new Uint8Array(48_000_001),{headers:{'Content-Type':'video/mp4'}}));await assert.rejects(oversized.load('large'),/limit/);oversized.close();
});
