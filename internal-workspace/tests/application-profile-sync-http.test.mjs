import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8792';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated loopback Worker only.');
const owner='sync-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'sync@example.test'};let current,checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function call(path,{method='GET',body,headers=auth}={}){const r=await fetch(base+path,{signal:AbortSignal.timeout(15000),method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.status>=500)console.error(path,r.status,data);return{status:r.status,data};}
async function act(action){current=(await call('/api/workspace')).data;const r=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
current=(await call('/api/workspace')).data;await act({type:'complete_onboarding',fullName:'Fictional Sync Applicant',headline:'SOC analyst',targetRole:'SOC Analyst',city:'Old City'});
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Fictional Sync Applicant\nsync@example.test\nEXPERIENCE\nInvestigated security alerts and documented incidents.'],'sync-fixture.txt',{type:'text/plain'}));eq((await call('/api/files',{method:'POST',body:upload})).status,200);
const pair=await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(pair.status,200);const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};
await act({type:'add_job',title:'Fictional SOC Analyst',company:'Sync fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner,description:'Isolated fixture; no employer contact.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:4,verificationHandoffVersion:2}})).data.task,ids={requestId:task.requestId,claimId:task.claimId},id=randomUUID(),query='?requestId='+task.requestId;
const handoff='/api/applications/handoff',workerHandoff='/api/application-agent/handoff',syncPath='/api/applications/profile-sync',workerSync='/api/application-agent/profile-sync';
const event=(event,extra={})=>call(workerHandoff,{method:'POST',headers:worker,body:{...ids,id,event,...extra}}),command=command=>call(handoff,{method:'POST',body:{requestId:task.requestId,id,command}}),sync=()=>call(syncPath,{method:'POST',body:ids});
eq((await event('begin',{profileSyncVersion:1,persistent:true,kind:'question',questions:['Which of the following best describes you?'],challengeHosts:[]})).status,200);
await act({type:'complete_onboarding',fullName:'Fictional Sync Applicant',headline:'SOC analyst',targetRole:'SOC Analyst',city:'New City'});
eq((await call(syncPath+query)).data.sync.outOfSync,true);
eq((await call(syncPath+query,{headers:{}})).status,401);eq((await call(syncPath+query,{headers:{'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'}})).status,404);
eq((await command('open')).status,200);eq((await call('/api/application-agent/authorize',{method:'POST',headers:worker,body:ids})).status,200);eq((await event('opened')).status,200);eq((await command('resume')).status,409);
eq((await call(syncPath,{method:'POST',body:{...ids,claimId:randomUUID()}})).status,409);
let r=await sync();eq(r.status,200);eq(r.data.sync.state,'pending');const first=r.data.id;
eq((await call('/api/application-agent/authorize',{method:'POST',headers:worker,body:ids})).status,409);
r=await call(workerSync+query+'&claimId='+task.claimId,{headers:worker});eq(r.status,200);eq(r.data.applicantProfile.city,'New City');eq(r.data.sync.id,first);
eq((await call(workerSync,{method:'POST',headers:worker,body:{...ids,id:first,profileSyncVersion:1}})).status,200);
eq((await call(syncPath+query)).data.sync.outOfSync,false);
await act({type:'complete_onboarding',fullName:'Fictional Sync Applicant',headline:'SOC analyst',targetRole:'SOC Analyst',city:'Newest City'});
r=await sync();eq(r.status,200);const second=r.data.id;
eq((await call(workerSync,{method:'POST',headers:worker,body:{...ids,id:first,profileSyncVersion:1}})).status,409);
await act({type:'complete_onboarding',fullName:'Fictional Sync Applicant',headline:'SOC analyst',targetRole:'SOC Analyst',city:'Final City'});
eq((await call(workerSync,{method:'POST',headers:worker,body:{...ids,id:second,profileSyncVersion:1}})).status,409);
r=await sync();eq(r.status,200);const latest=r.data.id;
eq((await call(workerSync,{method:'POST',headers:worker,body:{...ids,id:latest,profileSyncVersion:1,code:'form_needs_answers'}})).status,200);eq((await call(syncPath+query)).data.sync.state,'failed');
r=await sync();eq(r.status,200);eq(r.data.sync.state,'pending');eq((await call(workerSync,{method:'POST',headers:worker,body:{...ids,id:r.data.id,profileSyncVersion:1}})).status,200);
eq((await command('open')).status,200);eq((await event('opened')).status,200);eq((await command('resume')).status,200);eq((await event('resumed')).status,200);
eq((await call('/api/application-agent/authorize',{method:'POST',headers:worker,body:ids})).status,200);
current=(await call('/api/workspace')).data;const a=current.state.applications[0];eq(a.id,task.requestId);eq(a.claim.id,task.claimId);eq(a.cv.fileId,task.cv.id);eq(a.cvSha256,task.cv.sha256);eq(a.applicantProfile.city,'Final City');eq(a.status,'processing');eq(a.verificationHandoff.id,id);eq(current.state.applications.length,1);
if(process.env.CYBER_SYNC_UI_FIXTURE==='1'){
 await event('begin',{id:randomUUID(),profileSyncVersion:1,persistent:true,kind:'question',questions:['Which of the following best describes you?'],challengeHosts:[]});
 await act({type:'complete_onboarding',fullName:'Fictional Sync Applicant',headline:'SOC analyst',targetRole:'SOC Analyst',city:'UI Changed City'});await act({type:'complete_tutorial'});
 const {writeFile}=await import('node:fs/promises');await writeFile('.sites-runtime/profile-sync-ui.json',JSON.stringify({owner,requestId:task.requestId,claimId:task.claimId}));
}else{
 eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'uncertain',message:'Synthetic outcome only; no employer was contacted.'}})).status,200);eq((await sync()).status,409);
}
console.log(`PASS ${checks} same-browser profile synchronization HTTP checks: authenticated ownership, stale Open allowed, continuation blocked, original CV/claim retained, current target acknowledgement, failure/retry, and uncertain outcome protection.`);
