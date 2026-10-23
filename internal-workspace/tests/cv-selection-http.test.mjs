import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {strongCV} from './resume-fixtures.mjs';

const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('CV selection QA requires a loopback Worker.');
const owner=`cv-selection-${randomUUID()}`,other=`cv-selection-${randomUUID()}`;
const auth=who=>({'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`});
async function request(path,{who=owner,method='GET',body,origin}={}){
 const response=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{...auth(who),Connection:'close',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,data};
}
let current=(await request('/api/workspace')).data;
async function upload(text,name){const form=new FormData();form.set('revision',String(current.revision));form.set('file',new File([text],name));const result=await request('/api/files',{method:'POST',body:form});assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;return current.state.attachments[0];}
async function act(action){const result=await request('/api/workspace',{method:'POST',body:{revision:current.revision,action}});assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;}

const first=await upload(strongCV,'first-cv.txt');
const secondText=strongCV.replace('QA Candidate','Amina Candidate').replace('qa@example.test','amina@example.test');
const second=await upload(secondText,'second-cv.txt');
assert.equal(current.state.selectedCvId,second.id);
assert.equal(current.state.resumeReview.source.fileId,second.id);
const stale=await request(`/api/files/${first.id}/select`,{method:'POST',body:{revision:current.revision-1}});
assert.equal(stale.status,409);
const denied=await request(`/api/files/${first.id}/select`,{who:other,method:'POST',body:{revision:0}});
assert.equal(denied.status,404);
let result=await request(`/api/files/${first.id}/select`,{method:'POST',body:{revision:current.revision}});
assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;
assert.equal(current.state.selectedCvId,first.id);
assert.equal(current.state.profile.fullName,'QA Candidate');
assert.equal(current.state.resumeReview.source.fileId,first.id);
assert.equal(current.state.profile.reviewed,false);
await act({type:'save_profile',profile:{...current.state.profile,reviewed:true}});
await act({type:'add_job',title:'SOC Analyst',company:'QA Employer',location:'Lagos',workMode:'On-site',url:'https://qa.example.test/jobs/soc',description:'Review security alerts and report incidents to the response team.',skills:['SIEM']});
await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
assert.equal(current.state.applications[0].cv.fileId,first.id);
assert.equal(current.state.applications[0].candidate.resumeText,strongCV);
assert.equal(current.state.applications[0].status,'needs_action');
result=await request(`/api/files/${second.id}/select`,{method:'POST',body:{revision:current.revision}});
assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;
assert.equal(current.state.applications[0].cv.fileId,first.id);
assert.equal(current.state.applications[0].reason,'materials_changed');
await act({type:'refresh_application_materials',applicationId:current.state.applications[0].id});
assert.equal(current.state.applications[0].cv.fileId,second.id);
assert.equal(current.state.applications[0].candidate.resumeText,secondText);
assert.equal(current.state.applications[0].reason,'candidate_review_required');
result=await request(`/api/files/${second.id}`,{method:'DELETE',body:{revision:current.revision,confirmation:'DELETE_FILE'}});
assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;
assert.equal(current.state.selectedCvId,undefined);
assert.equal(current.state.applications[0].reason,'materials_changed');
assert.equal((await request(`/api/files/${second.id}`)).status,404);
assert.equal((await request(`/api/files/${first.id}`)).status,200);
const crossOrigin=await request(`/api/files/${first.id}/select`,{method:'POST',body:{revision:current.revision},origin:'https://unrelated.example'});
assert.equal(crossOrigin.status,403);
console.log('PASS: uploaded CV selection, per-request snapshot, update, deletion, revision and ownership checks');
