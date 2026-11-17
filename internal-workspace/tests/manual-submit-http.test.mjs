import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8796';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated loopback Worker only.');
const owner='handoff-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'handoff@example.test'};let current,checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function call(path,{method='GET',body,headers=auth}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.status>=500)console.error(path,r.status,data);return{status:r.status,data};}
async function act(action){const r=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
current=(await call('/api/workspace')).data;await act({type:'complete_onboarding',fullName:'Fictional Handoff Applicant',headline:'SOC analyst',targetRole:'SOC Analyst'});
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Fictional Handoff Applicant\nhandoff@example.test\nEXPERIENCE\nInvestigated security alerts and documented incidents.'],'handoff-fixture.txt',{type:'text/plain'}));const up=await call('/api/files',{method:'POST',body:upload});eq(up.status,200);current=up.data;
const pair=await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(pair.status,200);const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};current=(await call('/api/workspace')).data;
await act({type:'add_job',title:'Fictional SOC Analyst',company:'Handoff fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner,description:'Isolated fixture; no employer contact.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
eq((await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:1,verificationHandoffVersion:2}})).status,409);
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:2,verificationHandoffVersion:2}})).data.task,ids={requestId:task.requestId,claimId:task.claimId},id=randomUUID();

const workerPath='/api/application-agent/manual-submit',ownerPath='/api/applications/manual-submit',query='?requestId='+task.requestId;
const begin={...ids,id,event:'ready',challengeHosts:['www.google.com'],report:{journey:{version:1,submit_click_attempts:0,possible_delivery:false}}};
eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,challengeHosts:['evil.test']}})).status,409);
let r=await call(workerPath,{method:'POST',headers:worker,body:begin});eq(r.status,200);eq(r.data.session.state,'ready');eq(r.data.session.expiresAt,undefined);
eq((await call(workerPath,{method:'POST',headers:worker,body:begin})).data.session.id,id);
eq((await call(ownerPath+query,{headers:{}})).status,401);
eq((await call(ownerPath+query,{headers:{'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'}})).status,404);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,id:randomUUID()}})).status,409);
async function command(command,extra={}){return call(ownerPath,{method:'POST',body:{requestId:task.requestId,id,command,...extra}});}
eq((await command('open',{openConfirmed:true,approvedHosts:['evil.test']})).status,409);
eq((await command('open',{approvedHosts:['www.google.com']})).status,409);
eq((await command('open',{openConfirmed:false,approvedHosts:['www.google.com']})).status,409);
eq((await command('open',{openConfirmed:true,approvedHosts:[]})).status,409);
eq((await command('open',{openConfirmed:true,approvedHosts:['www.google.com']})).status,200);
r=await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}});eq(r.data.session.openRequested,true);eq(r.data.session.approvedHosts,['www.google.com']);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.openRequested,false);
eq((await command('open')).status,409);
eq((await command('open',{openConfirmed:true})).status,200);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.openRequested,true);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.openRequested,false);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'needs_submit'}})).data.session.state,'needs_submit');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'confirmed'}})).status,409);
eq((await command('cancel')).data.session.state,'cancel_requested');
// A genuine receipt wins a cancellation race, but no request is queued/retried.
const evidence={url:'https://fixture.example/confirmation',text:'Thank you for applying'};
r=await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'confirmed',evidence}});eq(r.status,200);eq(r.data.session.state,'confirmed');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'confirmed',evidence}})).status,200);
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'applied',message:'Confirmed',receipt:evidence.text,evidence,report:{journey:{version:1,submit_click_attempts:0,possible_delivery:true}}}})).status,200);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,1);eq(current.state.applications[0].status,'applied');eq(current.state.applications[0].claim.id,task.claimId);eq(current.state.applications[0].report.journey.submit_click_attempts,0);
eq((await command('cancel')).status,409);
// Older workers must never claim jobs under the retired automatic final-submit policy.
eq((await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).status,409);
console.log(`PASS ${checks} persistent manual-submit HTTP checks: owner/claim isolation, explicit native CAPTCHA access, idempotent state and confirmation, cancellation race, report preservation and old-runner rejection.`);
