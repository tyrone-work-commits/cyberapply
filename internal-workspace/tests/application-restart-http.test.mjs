import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8797';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated local Worker only.');
const owner='manual-health-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'health@example.test'};let checks=0,current;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function call(path,{body,headers=auth,method=body===undefined?'GET':'POST'}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw Error(path+' HTTP '+r.status+': '+text.slice(0,100));}return{status:r.status,data};}
current=(await call('/api/workspace')).data;
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Fictional Health QA\nhealth@example.test\nEXPERIENCE\nSOC Analyst\nPRIVATE HEALTH CV FIXTURE'],'health-fixture.txt',{type:'text/plain'}));eq((await call('/api/files',{body:upload})).status,200);
const pair=await call('/api/application-agent/pair',{body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(pair.status,200);const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};current=(await call('/api/workspace')).data;
async function act(action){const r=await call('/api/workspace',{body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
const capabilities={profileAnswersVersion:5,manualSubmitVersion:4,verificationHandoffVersion:2,coverLetterVersion:1,parallelApplicationsVersion:1};
const unsent={journey:{version:1,continue_click_attempts:0,submit_click_attempts:0,possible_delivery:false,manual_submit_observed:false,human_submit_observed:0},manual_submission:{policy:'user_final_submit',human_submit_observed:0,window:'hidden',state:'ready'}};
const ownerPath='/api/applications/manual-submit',workerPath='/api/application-agent/manual-submit';
async function fixture(label,legacy=false,begin=true){current=(await call('/api/workspace')).data;await act({type:'add_job',title:'Fictional '+label,company:'Isolated Health Employer',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner+'/'+label,description:'Isolated liveness fixture. No employer contacted.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});const r=await call('/api/application-agent/claim',{headers:worker,body:capabilities});eq(r.status,200);assert.ok(r.data.task);const task=r.data.task,id=randomUUID(),browserSessionId=randomUUID(),ids={requestId:task.requestId,claimId:task.claimId},health=legacy?{}:{browserHealthVersion:1,browserSessionId};
 const event=(event,extra={})=>call(workerPath,{headers:worker,body:{...ids,id,event,...health,...extra}}),command=(command,extra={})=>call(ownerPath,{body:{requestId:task.requestId,id,command,...extra}}),read=()=>call(ownerPath+'?requestId='+task.requestId),close=()=>call('/api/application-agent/browser-window',{headers:worker,body:{...ids,sessionId:browserSessionId,event:'closed'}});
 if(begin)eq((await event('ready',{report:unsent})).status,200);current=(await call('/api/workspace')).data;return{task,ids,id,browserSessionId,event,command,read,close};}
const a=await fixture('restart-hidden'),b=await fixture('restart-opened'),c=await fixture('restart-possible-delivery');
eq((await b.command('open',{openConfirmed:true})).status,200);
eq((await b.event('poll',{report:unsent})).status,200);
eq((await c.event('poll',{report:{journey:{...unsent.journey,possible_delivery:true,human_submit_observed:1,manual_submit_observed:true},manual_submission:{...unsent.manual_submission,human_submit_observed:1}}})).status,200);
const endpoint='/api/application-agent/restart-recovery';


// Startup/wake checks are read-only, including for older running workers.
const body={version:1,computerBootAt:new Date(Date.now()-1000).toISOString(),runnerStartedAt:new Date().toISOString()};
current=(await call('/api/workspace')).data;const before=structuredClone(current);
for(let n=0;n<3;n++){const r=await call(endpoint,{headers:worker,body});eq(r.status,200);eq(r.data,{restored:0,manualRecoveryRequired:true});}
current=(await call('/api/workspace')).data;eq(current.revision,before.revision);eq(current.state.applications,before.state.applications);
eq((await call('/api/application-agent/claim',{headers:worker,body:capabilities})).data.task,null);
console.log('Startup checks preserve every existing form and never queue or rotate a claim. Waiting for stale-session manual recovery fixture.');
await new Promise(resolve=>setTimeout(resolve,65000));
let r;
eq((await b.read()).data.health.canConfirmUnsent,true);eq((await b.command('confirm_unsent',{closedBeforeSubmitConfirmed:true})).status,409);
r=await b.command('confirm_unsent',{neverSubmittedConfirmed:true,closedBeforeSubmitConfirmed:true});eq(r.status,200);eq(r.data.session.openRequested,false);eq(r.data.session.reopenConfirmedAt,undefined);
eq((await c.read()).data.health.canConfirmUnsent,false);eq((await c.command('confirm_unsent',{neverSubmittedConfirmed:true,closedBeforeSubmitConfirmed:true})).status,409);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,3);eq(current.state.applications.some(item=>item.status==='applied'),false);
eq(current.state.applications.find(item=>item.id===a.task.requestId).claim.id,a.task.claimId);
eq(current.state.applications.find(item=>item.id===b.task.requestId).manualSubmission.state,'reopening');
eq((await call(endpoint,{headers:worker,body:{version:1,computerBootAt:'invalid'}})).status,400);
eq((await call(endpoint,{headers:{...auth,Connection:'close'},body:{version:1,computerBootAt:new Date().toISOString(),runnerStartedAt:new Date().toISOString()}})).status,401);
console.log(`PASS ${checks} manual-only restart HTTP checks: authenticated startup is read-only, exact claims and records remain unchanged, explicit owner recovery still works, and possible delivery blocks recovery. No employer contacted.`);
