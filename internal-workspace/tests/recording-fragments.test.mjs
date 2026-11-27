import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import ts from 'typescript';import {createFile} from 'mp4box';
const dir='.sites-runtime/recording-fragment-tests';await mkdir(dir,{recursive:true});
for(const name of ['recording-fragments','recording-snapshot'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {recordingFragment}=await import('../'+dir+'/recording-fragments.mjs'),{recordingSnapshot}=await import('../'+dir+'/recording-snapshot.mjs');
const parts=await Promise.all([0,1,2].map(async i=>{const b=await readFile(`tests/fixtures/recording-parts/part-${i}.mp4`);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}));
function parse(parts){const f=createFile(true);let position=0;for(const bytes of parts){f.appendBuffer(Object.assign(bytes.slice(0),{fileStart:position}));position+=bytes.byteLength;}f.flush();return f;}
test('streamed checkpoints form one full MP4 with every frame and continuous timestamps',async()=>{
 const bytes=[];let start=0,sequence=0,format;
 for(const part of parts){const next=recordingFragment(part.slice(0),start,6,sequence,format);if(!format)bytes.push(next.init);bytes.push(next.media);format=next.format;sequence=next.sequence;start+=next.duration;}
 const file=parse(bytes),info=file.getInfo(),track=info.videoTracks[0];assert.equal(info.duration/info.timescale,6);assert.equal(track.nb_samples,48);
 for(let i=1;i<track.nb_samples;i++){const a=file.getTrackSample(track.id,i-1),b=file.getTrackSample(track.id,i);assert.equal(a.dts+a.duration,b.dts);}
 let index=0;for(const part of parts){const original=parse([part]),t=original.getInfo().videoTracks[0];for(let i=0;i<t.nb_samples;i++)assert.deepEqual(file.getTrackSample(track.id,index++).data,original.getTrackSample(t.id,i).data);}
 await writeFile(`${dir}/streamed.mp4`,Buffer.concat(bytes.map(b=>Buffer.from(b))));
});
test('fragments can seek beyond the old ten-minute and one-hour cutoffs without storing earlier frames',()=>{
 const fragment=recordingFragment(parts[0].slice(0),7200,7202,6000),file=parse([fragment.init,fragment.media]),info=file.getInfo(),track=info.videoTracks[0];
 assert.equal(track.nb_samples,16);assert.equal(file.getTrackSample(track.id,0).dts,7200*track.timescale);assert.equal(info.duration/info.timescale,7202);
 assert.throws(()=>recordingFragment(parts[0].slice(0),0,2,0,{...fragment.format,width:1}),/formats/);
 assert.throws(()=>recordingFragment(parts[0].slice(0,25),0,2),/incomplete|unsupported/);
});
test('paginated indexes include more than 1000 checkpoints without duplicating current-run entries',async()=>{
 const base={applicationStatus:'processing',currentAttempt:'current',status:null,employer:{},applicationUpdatedAt:''};let calls=0;
 const rows=(start,end)=>Array.from({length:end-start},(_,i)=>({part:start+i,duration:2,size:10}));
 const fetcher=async url=>{calls++;const parts=url.includes('cursor=')?rows(999,2001):rows(0,1000);return Response.json({...base,items:[{attempt:'current',startedAt:'',recordedAt:'',duration:parts.length*2,size:parts.length*10,partial:false,parts}],nextCursor:calls===1?'next':null});};
 const snapshot=await recordingSnapshot('/recording',new AbortController().signal,fetcher);assert.equal(calls,2);assert.equal(snapshot.items[0].parts.length,2001);assert.equal(snapshot.items[0].duration,4002);assert.equal(snapshot.nextCursor,null);
});
