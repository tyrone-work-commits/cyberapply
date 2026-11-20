import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Loopback-only storage regression.');
const owner=`large-apply-${randomUUID()}`;
const headers=process.env.CYBER_TEST_COOKIE?{Cookie:process.env.CYBER_TEST_COOKIE}:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'qa@example.test'};
async function request(path,body){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
}
let packet=await request('/api/workspace');
assert.equal(packet.state.jobs.length,0,'Use an isolated empty local workspace.');
async function act(action){packet=await request('/api/workspace',{revision:packet.revision,action});}
await act({type:'complete_onboarding',fullName:'QA Candidate',headline:'Local fixture',targetRole:'SOC Analyst'});
await act({type:'complete_tutorial'});
const cv='QA Candidate\nqa@example.test\nSOC Analyst\nEXPERIENCE\n'+('- Monitored SIEM alerts in a fictional local test environment.\n'.repeat(150))+'SKILLS\nSIEM, Python';
const form=new FormData();form.set('revision',String(packet.revision));form.set('file',new File([cv],'local-qa-cv.txt',{type:'text/plain'}));
packet=await request('/api/files',form);
for(let n=1;JSON.stringify(packet.state).length<739349;n++){
 const remaining=739349-JSON.stringify(packet.state).length;
 await act({type:'add_job',title:`Local storage QA ${n}`,company:'Fictional QA employer',location:'Remote',workMode:'Remote',url:`https://qa.example.test/storage/${n}`,description:'Synthetic local-only job description. '+('x'.repeat(Math.min(7000,Math.max(20,remaining-400)))),skills:['SIEM']});
}
const chosen=packet.state.selectedCvId,job=packet.state.jobs[0];
assert.ok(chosen);
assert.ok(JSON.stringify(packet.state).length<750000);
if(process.env.CYBER_TEST_SEED_ONLY==='1'){
 console.log(JSON.stringify({localOnly:true,seeded:true,revision:packet.revision,characters:JSON.stringify(packet.state).length,firstTitle:job.title}));
}else{
 await act({type:'decide_job',jobId:job.id,decision:'apply',operationId:randomUUID()});
 assert.ok(JSON.stringify(packet.state).length>750000);
 assert.equal(packet.state.jobs.find(item=>item.id===job.id).disposition,'apply_requested');
 assert.equal(packet.state.applications.length,1);
 assert.equal(packet.state.applications[0].cv.fileId,chosen);
 const reloaded=await request('/api/workspace');
 assert.equal(reloaded.state.applications[0].cv.fileId,chosen);
 assert.equal(reloaded.revision,packet.revision);
 assert.equal(reloaded.state.applications[0].status,'needs_action');
 const source=await request(`/api/history?revision=${packet.revision}`);
 assert.equal(source.state.applications[0].cv.fileId,chosen);
 console.log('PASS local HTTP: Apply crosses the old storage limit, captures the chosen CV, and survives reload/history without employer submission.');
}
