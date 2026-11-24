import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8797';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated local Worker only.');
const owner='parallel-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'parallel@example.test'};let checks=0;
const eq=(a,b)=>{assert.equal(a,b);checks++;};
async function call(path,{body,headers=auth,method=body===undefined?'GET':'POST'}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const type=r.headers.get('content-type')||'';return{status:r.status,data:type.includes('json')?await r.json():await r.text()};}
let current=(await call('/api/workspace')).data;
const file=new FormData();file.set('revision',String(current.revision));file.set('file',new File(['Fictional Parallel QA\nparallel@example.test\nEXPERIENCE\nSOC Analyst\nIsolated CV fixture.'],'parallel-qa.txt',{type:'text/plain'}));eq((await call('/api/files',{body:file})).status,200);
const paired=await call('/api/application-agent/pair',{body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(paired.status,200);const worker={Authorization:'Bearer '+JSON.parse(paired.data.token).token};current=(await call('/api/workspace')).data;
async function act(action){const r=await call('/api/workspace',{body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
for(let i=0;i<12;i++){await act({type:'add_job',title:'Fictional SOC Analyst '+i,company:'Isolated parallel employer',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner+'/'+i,description:'Isolated parallel claim test; no employer contacted.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});}
const legacy={profileAnswersVersion:5,manualSubmitVersion:4,verificationHandoffVersion:2,coverLetterVersion:1},parallel={...legacy,parallelApplicationsVersion:1};
const claim=(body=parallel)=>call('/api/application-agent/claim',{headers:worker,body});
const first=await claim(legacy);eq(first.status,200);assert.ok(first.data.task);const tasks=[first.data.task];
const ids=t=>({requestId:t.requestId,claimId:t.claimId});
const firstSession=randomUUID();
eq((await call('/api/application-agent/manual-submit',{headers:worker,body:{...ids(tasks[0]),id:firstSession,event:'ready',browserHealthVersion:1,browserSessionId:randomUUID(),challengeHosts:[],report:{journey:{version:1,submit_click_attempts:0,continue_click_attempts:0,possible_delivery:false}}}})).status,200);
eq((await claim(legacy)).data.task,null);eq((await claim({...legacy,parallelApplicationsVersion:99})).data.task,null);
// True simultaneous HTTP claims exercise D1 revision conflicts. Only unclaimed
// requests may be picked again; an outcome/Submit is never retried here.
for(const result of await Promise.all(Array.from({length:9},()=>claim()))){assert.ok([200,409].includes(result.status));checks++;if(result.status===200&&result.data.task)tasks.push(result.data.task);}
for(let i=0;tasks.length<10&&i<20;i++){const r=await claim();eq(r.status,200);assert.ok(r.data.task);tasks.push(r.data.task);}
eq(tasks.length,10);eq(new Set(tasks.map(t=>t.requestId)).size,10);eq(new Set(tasks.map(t=>t.claimId)).size,10);eq((await claim()).data.task,null);
current=(await call('/api/workspace')).data;eq(current.state.applications.filter(a=>a.status==='processing').length,10);eq(current.state.applications.filter(a=>a.status==='queued').length,2);eq(current.state.applications.find(a=>a.id===tasks[0].requestId).manualSubmission.id,firstSession);
const secondSession=randomUUID();eq((await call('/api/application-agent/manual-submit',{headers:worker,body:{...ids(tasks[1]),id:secondSession,event:'ready',browserHealthVersion:1,browserSessionId:randomUUID(),challengeHosts:[]}})).status,200);
eq((await call('/api/applications/manual-submit',{body:{requestId:tasks[0].requestId,id:firstSession,command:'open',openConfirmed:true,approvedHosts:[]}})).status,200);
let a=await call('/api/application-agent/manual-submit?'+new URLSearchParams(ids(tasks[0])),{headers:worker});eq(a.data.session.openRequested,true);
a=await call('/api/application-agent/manual-submit?'+new URLSearchParams(ids(tasks[1])),{headers:worker});eq(a.data.session.openRequested,false);eq(a.data.session.id,secondSession);
eq((await call('/api/application-agent/cv?'+new URLSearchParams({requestId:tasks[1].requestId,claimId:tasks[0].claimId}),{headers:worker})).status,409);
eq((await call('/api/application-agent/result',{headers:worker,body:{...ids(tasks[1]),status:'applied',message:'No evidence'}})).status,409);
const otherAuth={'oai-authenticated-user-id':'foreign-'+owner,'oai-authenticated-user-email':'foreign@example.test'};
eq((await call('/api/applications/manual-submit?requestId='+tasks[0].requestId,{headers:otherAuth})).status,404);
const otherPair=await call('/api/application-agent/pair',{headers:otherAuth,body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(otherPair.status,200);const otherWorker={Authorization:'Bearer '+JSON.parse(otherPair.data.token).token};
eq((await call('/api/application-agent/cv?'+new URLSearchParams(ids(tasks[0])),{headers:otherWorker})).status,409);eq((await claim()).data.task,null);
eq((await call('/api/application-agent/result',{headers:worker,body:{...ids(tasks[2]),status:'needs_attention',message:'Fictional missing answer. No employer submission.'}})).status,200);
const replacement=await claim();eq(replacement.status,200);assert.ok(replacement.data.task);assert.ok(!tasks.some(t=>t.requestId===replacement.data.task.requestId));checks++;
eq((await claim()).data.task,null);current=(await call('/api/workspace')).data;eq(current.state.applications.filter(a=>a.status==='processing').length,10);eq(current.state.applications.filter(a=>a.status==='applied').length,0);eq(current.state.applications.find(a=>a.id===tasks[2].requestId).status,'needs_attention');
console.log(`PASS ${checks} parallel HTTP checks: ten distinct claims; manual session/CV/owner isolation; legacy compatibility; slot reuse and confirmation boundary. No employer traffic.`);
