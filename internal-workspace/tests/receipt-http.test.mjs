import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8792';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Use the isolated compiled loopback Worker without connector bindings.');
const owner='receipt-http-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'receipt-qa@example.test'};
let checks=0;
function equal(actual,expected,note){assert.equal(actual,expected,note);checks++;}
async function call(path,{method='GET',body,headers=auth}={}){const response=await fetch(base+path,{method,headers:{Origin:new URL(base).origin,...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};}
async function receipts(action,headers=auth){return call('/api/applications/receipts',{method:'POST',headers,body:{action}});}
equal((await receipts('check',{})).status,401,'identity is required');
equal((await call('/api/applications/receipts',{method:'POST',body:{action:'check',messageId:'invented',status:'applied'}})).status,400,'clients cannot supply receipt evidence or desired status');
let current=(await call('/api/workspace')).data;
const form=new FormData();form.set('revision',String(current.revision));form.set('file',new File(['Receipt QA\nreceipt-qa@example.test\nSOC Analyst\nSKILLS\nPython, SIEM\nEXPERIENCE\nInvestigated alerts.'],'receipt-qa.txt',{type:'text/plain'}));current=(await call('/api/files',{method:'POST',body:form})).data;
const pair=(await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}})).data;
const worker={Authorization:'Bearer '+JSON.parse(pair.token).token};current=(await call('/api/workspace')).data;
async function act(action){const result=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});equal(result.status,200);current=result.data;}
await act({type:'add_job',title:'Receipt Fixture Analyst',company:'Fictional QA',location:'Remote',workMode:'Remote',url:'https://employer.example/'+owner,description:'Local receipt test only. No real employer is contacted.',skills:['SIEM']});
await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task;
equal((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{requestId:task.requestId,claimId:task.claimId,status:'uncertain',message:'Fictional local test: delivery not known.'}})).status,200);
current=(await call('/api/workspace')).data;const before=structuredClone(current);
const concurrent=await Promise.all([receipts('enable'),receipts('enable')]);
assert.deepEqual(concurrent.map(r=>r.status).sort(),[429,503]);checks++;
equal(concurrent.find(r=>r.status===503).data.status,'binding_unavailable','local fixture has no live Gmail binding');
current=(await call('/api/workspace')).data;
equal(current.state.receiptChecksEnabled,true,'explicit enable persists');equal(current.revision,before.revision+1,'concurrent enable creates one setting revision');
assert.deepEqual(current.state.applications,before.state.applications,'connector failure never changes outcomes or materials');checks++;
const wait=await receipts('check');equal(wait.status,429);assert.ok(wait.data.retryAfterMs>0&&wait.data.retryAfterMs<=120000);checks++;
equal((await call('/api/workspace')).data.revision,current.revision,'checks without a receipt do not churn saved revisions');
const other={'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'};
equal((await call('/api/workspace',{headers:other})).data.state.receiptChecksEnabled,undefined,'settings are owner scoped');
equal((await receipts('enable',other)).data.status,'idle','another owner does not see these pending applications');
equal((await receipts('disable')).status,200);current=(await call('/api/workspace')).data;equal(current.state.receiptChecksEnabled,false);
equal((await call('/api/applications/receipts',{method:'POST',body:{action:'check',automatic:true}})).data.status,'disabled','stale timers stop after disabling');
equal((await call('/api/account',{method:'DELETE',body:{revision:current.revision,confirmation:'DELETE CYBERAPPLY'}})).status,200,'account cleanup also removes receipt-check metadata');
// Local Windows Wrangler can restart after rejecting an unread request body; run this check last.
equal((await call('/api/applications/receipts',{method:'POST',headers:{...auth,Origin:'https://other.example'},body:{action:'check'}})).status,403,'cross origin denied');
console.log(`PASS ${checks} receipt HTTP checks: identity, CSRF, evidence injection, owner isolation, concurrent throttle, failed connector safety, settings, disabling and account cleanup.`);
