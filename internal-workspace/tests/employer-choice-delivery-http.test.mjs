import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8794';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Loopback QA only.');
const owner='choice-delivery-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'choices@example.test'};let count=0;
const eq=(a,b)=>{assert.equal(a,b);count++;};
async function call(path,{body,headers=auth}={}){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
let current=(await call('/api/workspace')).data;
async function act(action){const r=await call('/api/workspace',{body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
await act({type:'complete_onboarding',fullName:'Choice QA',headline:'SOC analyst',targetRole:'SOC Analyst'});
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Choice QA\nchoices@example.test\nSOC Analyst 2023 - 2025\nInvestigated Splunk alerts.'],'choice-qa.txt',{type:'text/plain'}));
current=(await call('/api/files',{body:upload})).data;
const pair=await call('/api/application-agent/pair',{body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(pair.status,200);
const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};current=(await call('/api/workspace')).data;
await act({type:'add_job',title:'SOC Analyst',company:'Choice Fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner,description:'Fictional metadata delivery test. No real employer is contacted.',skills:['Splunk']});
await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
const claimed=await call('/api/application-agent/claim',{headers:worker,body:{profileAnswersVersion:4}});eq(claimed.status,200);const task=claimed.data.task;
const options=Array.from({length:181},(_,i)=>`Offered calling country ${i}`),ids={requestId:task.requestId,claimId:task.claimId};
eq((await call('/api/application-agent/questions',{headers:worker,body:{...ids,questions:[{question:'Country',field_type:'combobox',options}]}})).status,200);
current=(await call('/api/workspace')).data;eq(current.state.applications[0].status,'processing');eq(current.state.accountProfile.employerQuestions.find(q=>q.question==='Country').options.length,181);
eq((await call('/api/application-agent/questions',{headers:worker,body:{...ids,questions:[{question:'Preferred shift?',field_type:'combobox',options:options.slice(0,101)}]}})).status,400);
eq((await call('/api/application-agent/questions',{headers:worker,body:{...ids,questions:[{question:'Country',field_type:'combobox',options:[...options,...options,...options]}]}})).status,400);
eq((await call('/api/application-agent/questions',{headers:worker,body:{...ids,claimId:'00000000-0000-0000-0000-000000000000',questions:[{question:'Country',field_type:'combobox',options}]}})).status,409);
eq((await call('/api/application-agent/result',{headers:worker,body:{...ids,status:'needs_attention',message:'Fictional known-unsent pause.',report:{questions:[{question:'Country',field_type:'combobox',options:[]}]}}})).status,200);
current=(await call('/api/workspace')).data;eq(current.state.accountProfile.employerQuestions.find(q=>q.question==='Country').options.length,181);eq(current.state.applications[0].status,'needs_attention');eq(current.state.applications[0].report.locationCapture,undefined);
const foreign={'oai-authenticated-user-id':'other-'+randomUUID(),'oai-authenticated-user-email':'other@example.test'};
const other=await call('/api/workspace',{headers:foreign});eq((await call('/api/applications/questions/refresh',{headers:foreign,body:{revision:other.data.revision,applicationId:task.requestId}})).status,404);
console.log(`PASS ${count} dropdown-delivery HTTP checks: large catalogs, bounds, claim/owner isolation, empty-report retention and no application replay.`);
