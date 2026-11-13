import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
import {createFile} from 'mp4box';
const dir='.sites-runtime/continuous-recording-tests';await mkdir(dir,{recursive:true});
await writeFile(`${dir}/continuous-recording.mjs`,ts.transpileModule(await readFile('lib/continuous-recording.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {combineRecordingParts}=await import('../'+dir+'/continuous-recording.mjs');
const parts=await Promise.all([0,1,2].map(async i=>{const bytes=await readFile(`tests/fixtures/recording-parts/part-${i}.mp4`);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}));
function parse(bytes){const file=createFile(true);file.appendBuffer(Object.assign(bytes,{fileStart:0}));file.flush();return file;}
test('three checkpoints become one continuous six-second MP4, preserving all frames and their order',async()=>{
 const result=combineRecordingParts(parts),file=parse(result),info=file.getInfo(),track=info.videoTracks[0];
 assert.equal(info.tracks.length,1);assert.equal(track.nb_samples,48);assert.equal(info.duration/info.timescale,6);
 const samples=Array.from({length:48},(_,i)=>file.getTrackSample(track.id,i));
 assert.equal(samples.at(-1).dts+samples.at(-1).duration,track.timescale*6);
 for(let i=1;i<samples.length;i++)assert.equal(samples[i].dts,samples[i-1].dts+samples[i-1].duration);
 let offset=0;for(const part of parts){const input=parse(part),t=input.getInfo().videoTracks[0];for(let i=0;i<t.nb_samples;i++)assert.deepEqual(samples[offset++].data,input.getTrackSample(t.id,i).data);}
 await writeFile(`${dir}/combined.mp4`,new Uint8Array(result));
});
test('invalid, incomplete and oversized inputs fail rather than skipping footage',()=>{
 assert.throws(()=>combineRecordingParts([]),/limit/);assert.throws(()=>combineRecordingParts(Array(361).fill(parts[0])),/limit/);
 assert.throws(()=>combineRecordingParts([new ArrayBuffer(48_000_001)]),/limit/);
 assert.throws(()=>combineRecordingParts([parts[0],parts[1].slice(0,25)]),/read|format|incomplete/);
});

test('a paused run and a resumed run extend the same seekable video beyond the old per-run limit',()=>{
 const result=combineRecordingParts(Array(62).fill(parts[0])),info=parse(result).getInfo();
 assert.equal(info.videoTracks[0].nb_samples,62*16);assert.equal(info.duration/info.timescale,124);
});
