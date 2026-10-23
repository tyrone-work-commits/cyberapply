import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {strongCV} from './resume-fixtures.mjs';

const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Agent bridge test requires a loopback Worker.');
const owner=`agent-${randomUUID()}`,other=`agent-${randomUUID()}`;
const headers=who=>({'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`});
async function request(path,{who=owner,method='GET',body,token,raw=false}={}){
 const response=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{...headers(who),Connection:'close',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 if(raw)return{status:response.status,body:await response.text()};
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,data};
}
let current=(await request('/api/workspace')).data;
async function act(action){const result=await request('/api/workspace',{method:'POST',body:{revision:current.revision,action}});assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;}
const form=new FormData();form.set('revision',String(current.revision));form.set('file',new File([strongCV],'agent-cv.txt'));
let upload=await fetch(base+'/api/files',{method:'POST',headers:{...headers(owner),Connection:'close'},body:form,signal:AbortSignal.timeout(30000)});
assert.equal(upload.status,200);current=await upload.json();
await act({type:'save_profile',profile:{...current.state.profile,reviewed:true}});
await act({type:'add_job',title:'Security Analyst',company:'Fictional Employer',location:'Remote',workMode:'Remote',url:'https://qa.example.test/jobs/security',description:'Investigate incidents and monitor security alerts using SIEM.',skills:['SIEM']});
await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
assert.equal(current.state.applications[0].status,'needs_action','old requests must not auto-submit after pairing');
let paired=await request('/api/agent/pair',{method:'POST',body:{revision:current.revision}});
assert.equal(paired.status,200,JSON.stringify(paired.data));const token=paired.data.token;assert.ok(token.startsWith('ca1.'));
const oldClaim=await request('/api/agent/claim',{method:'POST',token});assert.equal(oldClaim.status,200,JSON.stringify(oldClaim.data));assert.equal(oldClaim.data.job,null,'old swipe was not queued');
current=(await request('/api/workspace')).data;
await act({type:'queue_application',applicationId:current.state.applications[0].id});
const claim=await request('/api/agent/claim',{method:'POST',token});
assert.equal(claim.status,200,JSON.stringify(claim.data));assert.equal(claim.data.job.company,'Fictional Employer');
assert.equal(claim.data.application.cv.name,'agent-cv.txt');
assert.match(claim.data.application.coverLetter,/Security Analyst role at Fictional Employer/);
const id=claim.data.application.id,claimId=claim.data.application.claimId;
assert.equal((await request('/api/agent/claim',{method:'POST',token})).data.job,null,'an active claim is not duplicated');
const file=await request(`/api/agent/cv?applicationId=${encodeURIComponent(id)}&claimId=${claimId}`,{token,raw:true});
assert.equal(file.status,200);assert.equal(file.body,strongCV);
assert.equal((await request(`/api/agent/cv?applicationId=${encodeURIComponent(id)}&claimId=wrong`,{token})).status,404);
assert.equal((await request('/api/agent/result',{method:'POST',token,body:{applicationId:id,claimId,status:'applied',message:'Fixture confirmation'}})).status,409,'receipt is required');
const result=await request('/api/agent/result',{method:'POST',token,body:{applicationId:id,claimId,status:'applied',message:'Fictional employer confirmed the application.',receipt:'FICT-123'}});
assert.equal(result.status,200,JSON.stringify(result.data));
current=(await request('/api/workspace')).data;assert.equal(current.state.applications[0].status,'applied');assert.equal(current.state.applications[0].result.receipt,'FICT-123');
assert.equal((await request('/api/agent/result',{method:'POST',token,body:{applicationId:id,claimId,status:'applied',message:'Duplicate',receipt:'FICT-123'}})).status,409);
assert.equal((await request('/api/agent/pair',{who:other})).data.paired,false,'other visitor has independent pairing');
const revoke=await request('/api/agent/pair',{method:'DELETE',body:{revision:current.revision}});assert.equal(revoke.status,200);
assert.equal((await request('/api/agent/claim',{method:'POST',token})).status,401,'revocation takes effect immediately');
assert.equal((await request('/api/agent/claim',{method:'POST',token:'bad'})).status,401);
console.log('PASS: owner-scoped agent pairing, explicit queue, chosen CV, claim, receipt, idempotency, revocation');
