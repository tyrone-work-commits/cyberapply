// Run after the production build: dev-mode worker URLs do not expose this regression.
import assert from 'node:assert/strict';import {readdir,readFile,stat} from 'node:fs/promises';import {join} from 'node:path';
const root='dist/client';async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]))).flat();}
const assets=await files(root);let references=0;
for(const asset of assets.filter(p=>p.endsWith('.js')&&!p.includes('recording-remux.worker-'))){
 const text=await readFile(asset,'utf8');if(!text.includes('recording-remux.worker-'))continue;
 assert.doesNotMatch(text,/new Worker\(new URL\([^)]*file:/,'The hosted video worker must not resolve against a local source-file URL.');
 for(const match of text.matchAll(/\/_next\/static\/recording-remux\.worker-[\w-]+\.js/g)){
  assert.ok((await stat(join(root,match[0]))).isFile(),'The production worker asset must exist.');references++;
 }
}
assert.ok(references>0,'The browser bundle must reference its hosted remux worker.');
console.log('PASS production recording worker: same-origin asset URL and packaged JavaScript.');
