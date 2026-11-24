import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8797';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated loopback Worker only.');
const owner='desktop-notice-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'notice@example.test'};let checks=0;
const eq=(a,b)=>{assert.equal(a,b);checks++;};
async function call(path,{body,headers=auth,method=body===undefined?'GET':'POST'}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{if(r.status===503&&text.startsWith('Your worker restarted mid-request.'))data={localHostRestart:true};else throw Error(`${body===undefined?'GET':'POST'} ${path} HTTP ${r.status}: ${text.slice(0,300)}`);}return {status:r.status,data};}
let current=(await call('/api/workspace')).data;
const file=new FormData();file.set('revision',String(current.revision));file.set('file',new File(['Fictional Notification QA\nnotice@example.test\nEXPERIENCE\nSOC Analyst\nPRIVATE CV FIXTURE.'],'notification-qa.txt',{type:'text/plain'}));eq((await call('/api/files',{body:file})).status,200);
const paired=await call('/api/application-agent/pair',{body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(paired.status,200);const worker={Authorization:'Bearer '+JSON.parse(paired.data.token).token};current=(await call('/api/workspace')).data;
async function act(action){const r=await call('/api/workspace',{body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
const heartbeat=(headers=worker,state='working')=>call('/api/application-agent/heartbeat',{headers,body:{state}});
const capabilities={profileAnswersVersion:5,manualSubmitVersion:4,verificationHandoffVersion:2,coverLetterVersion:1};
for(const title of ['Fictional SOC Analyst','Fictional Security Engineer']){
 await act({type:'add_job',title,company:'Isolated notice employer',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+randomUUID(),description:'Isolated notification test. No employer contact.',skills:[]});
 await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
 const claim=await call('/api/application-agent/claim',{headers:worker,body:capabilities});eq(claim.status,200);const task=claim.data.task;
 if(title.includes('Analyst')){
  eq((await heartbeat()).data.notices.length,0);
  eq((await call('/api/application-agent/result',{headers:worker,body:{requestId:task.requestId,claimId:task.claimId,status:'needs_attention',message:'Fictional ordinary question pause.',report:{questions:[{question:'Preferred shift?',field_type:'select',options:['Day','Night']}],unresolved:[{question:'Preferred shift?',field_type:'select'}]}}})).status,200);
 }else{
  const ready=await call('/api/application-agent/manual-submit',{headers:worker,body:{requestId:task.requestId,claimId:task.claimId,id:randomUUID(),event:'ready',browserHealthVersion:1,browserSessionId:randomUUID(),challengeHosts:[],report:{journey:{version:1,submit_click_attempts:0,continue_click_attempts:0,possible_delivery:false}}}});eq(ready.status,200);
 }
 current=(await call('/api/workspace')).data;
}
const before=(await call('/api/workspace')).data;
const result=await heartbeat();eq(result.status,200);eq(result.data.notices.length,2);assert.deepEqual(new Set(result.data.notices.map(n=>n.kind)),new Set(['input','submit']));checks++;
assert.doesNotMatch(JSON.stringify(result.data),/PRIVATE|resumeText|cvSha256|notice@example|options|Preferred shift/);checks++;
eq((await call('/api/workspace')).data.revision,before.revision);assert.deepEqual((await call('/api/workspace')).data.state,before.state);checks++;
assert.deepEqual((await heartbeat()).data.notices,result.data.notices);checks++;
eq((await heartbeat(worker,'stopped')).data.notices.length,0);
eq((await heartbeat({})).status,401);
// Local host can translate a rejected Bearer credential into its plain-text 503.
// Both must stay closed; every successful path above still requires HTTP 200.
const rejected=await heartbeat({...auth,Authorization:'Bearer ca1.old'});assert.ok([401,503].includes(rejected.status));checks++;eq(rejected.data.notices,undefined);
// Existing heartbeat validation maps strict-schema errors to a generic 500.
const invalidBody=await call('/api/application-agent/heartbeat',{headers:worker,body:{state:'running',ownerId:'other'}});eq(invalidBody.status,500);eq(invalidBody.data.notices,undefined);
const other={'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'};
const otherPair=await call('/api/application-agent/pair',{headers:other,body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(otherPair.status,200);
const otherWorker={Authorization:'Bearer '+JSON.parse(otherPair.data.token).token};eq((await heartbeat(otherWorker)).data.notices.length,0);
eq((await heartbeat()).data.notices.length,2);
eq((await call('/api/application-agent/pair',{method:'DELETE'})).status,200);const revoked=await heartbeat();assert.ok([401,503].includes(revoked.status));checks++;eq(revoked.data.notices,undefined);
console.log(`PASS ${checks} desktop notification HTTP checks: no browser client, input/submit events, stable bounded metadata, owner isolation, stopped/revoked behavior and no workspace/application mutation.`);
