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
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task,ids={requestId:task.requestId,claimId:task.claimId},id=randomUUID();
const begin={...ids,id,event:'begin',kind:'challenge',questions:['Complete the synthetic manual check'],challengeHosts:['www.google.com']};
const workerPath='/api/application-agent/handoff',ownerPath='/api/applications/handoff',query='?requestId='+task.requestId;
eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,challengeHosts:['evil.test']}})).status,409);
let r=await call(workerPath,{method:'POST',headers:worker,body:begin});eq(r.status,200);eq(r.data.handoff.state,'waiting');assert.ok(Date.parse(r.data.handoff.expiresAt)<=Date.now()+240000);checks++;
eq((await call(workerPath,{method:'POST',headers:worker,body:begin})).data.handoff.id,id);
eq((await call(ownerPath+query,{headers:{}})).status,401);eq((await call(ownerPath+query,{headers:{'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'}})).status,404);
eq((await call(ownerPath+query)).data.active,true);
async function command(command,extra={}){return call(ownerPath,{method:'POST',body:{requestId:task.requestId,id,command,...extra}});}
eq((await command('resume')).status,409);eq((await command('open')).status,409);eq((await command('open',{approvedHosts:['www.google.com','evil.test']})).status,409);
eq((await command('open',{id:randomUUID(),approvedHosts:['www.google.com']})).status,409);
eq((await command('open',{approvedHosts:['www.google.com']})).data.handoff.state,'opening');eq((await command('open',{approvedHosts:['www.google.com']})).status,409);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'resumed'}})).status,409);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'opened'}})).data.handoff.state,'opened');
eq((await command('resume')).data.handoff.state,'resuming');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'opened',code:'incomplete'}})).data.handoff.code,'incomplete');
eq((await command('resume')).data.handoff.state,'resuming');eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'resumed'}})).data.handoff.state,'resumed');eq((await call(ownerPath+query)).data.active,false);
const second=randomUUID();eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,id:second}})).data.handoff.turn,2);eq((await call(ownerPath,{method:'POST',body:{requestId:task.requestId,id:second,command:'cancel'}})).data.handoff.state,'cancelled');eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,id:randomUUID()}})).status,409);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,1);eq(current.state.applications[0].status,'processing');eq(current.state.applications[0].claim.id,task.claimId);eq(current.state.applications[0].cv.fileId,task.cv.id);eq(current.state.accountProfile.fullName,'Fictional Handoff Applicant');
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'needs_attention',message:'Isolated manual handoff finished; no employer visited.'}})).status,200);
eq((await command('resume')).status,409);eq((await call(workerPath+query+'&claimId='+task.claimId,{headers:worker})).status,409);
console.log(`PASS ${checks} exact-session handoff HTTP checks: owner/claim isolation, destination consent, expiry bounds, commands, manual-only resume, cancellation and unchanged application/CV facts.`);
