// Run after the production build: dev-mode worker URLs do not expose this regression.
import assert from 'node:assert/strict';import {readdir,readFile,stat} from 'node:fs/promises';import {join} from 'node:path';
const root='dist/client';async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]))).flat();}
const assets=await files(root),javascript=(await Promise.all(assets.filter(p=>p.endsWith('.js')).map(p=>readFile(p,'utf8')))).join('\n');
assert.match(javascript,/new MediaSource/,'The production player must stream bounded checkpoints.');
assert.match(javascript,/addSourceBuffer/);assert.match(javascript,/seeking/);
assert.doesNotMatch(javascript,/new Worker\(new URL\([^)]*file:/,'Playback must not depend on a local worker path.');
assert.doesNotMatch(javascript,/recording-remux\.worker-/,'Full recordings must not be combined into one browser-memory Blob.');
console.log('PASS production recording stream: packaged MediaSource playback and no whole-video worker dependency.');
