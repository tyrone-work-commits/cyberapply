import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE;
if(!base||!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Use an isolated loopback Worker with fictional data.');
const owner='delete-test-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'deletion@example.test'};
async function call(path,{method='GET',body,headers=auth,binary=false}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return {status:r.status,data:binary?new Uint8Array(await r.arrayBuffer()):await r.json()};}
let current=(await call('/api/workspace')).data;
async function act(action){const r=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});assert.equal(r.status,200,JSON.stringify(r.data));current=r.data;}
await act({type:'complete_onboarding',fullName:'Fictional QA',headline:'Fixture',targetRole:'SOC Analyst',city:'Fixture city',phone:'+12345678901',expectedSalary:{amount:2000,currency:'USD',period:'month'},usaVisaRequired:true,usaRightToWork:false});
const form=new FormData();form.set('revision',String(current.revision));form.set('file',new File(['QA Candidate\nqa@example.test\nSOC Analyst\nSUMMARY\nCybersecurity analyst with Python and incident investigation experience.\nSKILLS\nPython, SIEM'],'fixture.txt',{type:'text/plain'}));current=(await call('/api/files',{method:'POST',body:form})).data;
const originalProfile=structuredClone(current.state.accountProfile),file=current.state.attachments[0];
const pair=await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});assert.equal(pair.status,200);const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};current=(await call('/api/workspace')).data;
for(const suffix of ['one','two']){await act({type:'add_job',title:'Fictional '+suffix,company:'QA',location:'Remote',workMode:'Remote',url:`https://fixture.example/${owner}/${suffix}`,description:'Fictional local deletion test role only.',skills:['Python']});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});}
const [a,b]=current.state.applications;
async function remove(scope,extra={}){return call('/api/applications/delete',{method:'POST',body:{revision:current.revision,scope,confirmation:'PERMANENTLY DELETE',...extra}});}
assert.equal((await remove('application',{applicationId:a.id,confirmation:'wrong'})).status,400);
assert.equal((await remove('application',{applicationId:a.id,revision:0})).status,409);
assert.equal((await call('/api/applications/delete',{method:'POST',headers:{...auth,Origin:'https://other.example'}})).status,403);
assert.equal((await call('/api/applications/delete',{method:'POST',body:{revision:current.revision,scope:'application',applicationId:a.id,confirmation:'PERMANENTLY DELETE'},headers:{}})).status,401);
const otherHeaders={'oai-authenticated-user-id':'other-'+owner,'oai-authenticated-user-email':'other@example.test'};const other=(await call('/api/workspace',{headers:otherHeaders})).data;
assert.equal((await call('/api/applications/delete',{method:'POST',headers:otherHeaders,body:{revision:other.revision,scope:'application',applicationId:a.id,confirmation:'PERMANENTLY DELETE'}})).status,404);
const task=(await call('/api/application-agent/claim',{method:'POST',body:{profileAnswersVersion:2},headers:worker})).data.task;assert.ok(task);current=(await call('/api/workspace')).data;
assert.equal((await remove('application',{applicationId:task.requestId})).status,409);
assert.equal((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{requestId:task.requestId,claimId:task.claimId,status:'needs_attention',message:'Fictional fixture paused without contacting an employer.'}})).status,200);
current=(await call('/api/workspace')).data;
const deleted=await remove('application',{applicationId:a.id});assert.equal(deleted.status,200,JSON.stringify(deleted.data));current=deleted.data;
assert.equal(current.state.applications.length,1);assert.equal(current.state.applications[0].id,b.id);assert.ok(!JSON.stringify(current.state).includes(a.id));
await act({type:'clear_applications',confirmation:'CLEAR_APPLICATIONS'});
const connection=structuredClone(current.state.newApplicationAgent),oldRevision=current.revision;
const cleared=await remove('cleared',{deleteCandidateFacts:true});assert.equal(cleared.status,200,JSON.stringify(cleared.data));current=cleared.data;
assert.equal(current.state.applicationArchive,undefined);assert.equal(current.state.applications.length,0);assert.equal(current.state.drafts.length,0);assert.equal(current.state.legacyCandidateFactsDeleted,true);
assert.deepEqual(current.state.accountProfile,originalProfile);assert.deepEqual(current.state.newApplicationAgent,connection);assert.equal(current.state.selectedCvId,file.id);assert.ok(current.state.profile.resumeText.includes('QA Candidate'));assert.equal(current.state.profile.reviewed,false);
assert.equal((await call('/api/files/'+file.id,{binary:true})).status,200);
const history=(await call('/api/history')).data.items;
for(const row of history){const snap=(await call('/api/history?revision='+row.revision)).data;assert.ok(!JSON.stringify(snap.state).includes(a.id));assert.ok(!JSON.stringify(snap.state).includes(b.id));assert.equal(snap.state.applicationArchive,undefined);assert.equal(snap.state.drafts.length,0);if(row.revision<=oldRevision)assert.equal(snap.state.profile.resumeText,'');}
assert.equal((await call('/api/workspace',{method:'POST',body:{revision:current.revision,action:{type:'restore_applications'}}})).status,409);
assert.equal((await call('/api/workspace',{method:'POST',body:{revision:current.revision,action:{type:'save_profile',profile:current.state.profile}}})).status,410);
const otherAfter=(await call('/api/workspace',{headers:otherHeaders})).data;assert.deepEqual(otherAfter,other);
console.log(`PASS permanent deletion HTTP: individual and cleared records removed across ${history.length} saved versions; legacy facts retired; profile/CV/connection preserved; active claim, confirmation, ownership, origin and stale-write guards verified.`);
