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

const gate='/api/applications/browser-recovery',action={action:'recover_expired_sessions'};
const a=await fixture('automatic-hidden'),b=await fixture('automatic-opened'),c=await fixture('automatic-delivery');
eq((await b.command('open',{openConfirmed:true})).status,200);
eq((await b.close()).status,200);
eq((await c.event('poll',{report:{journey:{...unsent.journey,possible_delivery:true,human_submit_observed:1,manual_submit_observed:true},manual_submission:{...unsent.manual_submission,human_submit_observed:1}}})).status,200);
eq((await c.close()).status,200);
eq((await a.close()).status,200);
const before=(await call('/api/workspace')).data;
const readOnly=await call(gate);eq(readOnly.status,200);eq(readOnly.data.entries.find(e=>e.requestId===a.task.requestId).autoRecoverable,true);
eq((await call('/api/workspace')).data.revision,before.revision);
const foreign={'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'};
eq((await call(gate,{headers:foreign,body:action})).data.restored,0);
eq((await call(gate,{headers:{...auth,Origin:'https://untrusted.example'},body:action})).status,403);
eq((await call(gate,{body:{...action,requestId:a.task.requestId}})).status,400);
let r=await call(gate,{body:action});eq(r.status,200);eq(r.data.restored,1);eq(r.data.entries.find(e=>e.requestId===a.task.requestId).state,'restoring');
eq((await call(gate,{body:action})).data.restored,0);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,3);
const restored=current.state.applications.find(e=>e.id===a.task.requestId),original=before.state.applications.find(e=>e.id===a.task.requestId);
eq(restored.status,'queued');eq(restored.cv,original.cv);eq(restored.cvSha256,original.cvSha256);eq(restored.confirmedAnswers,original.confirmedAnswers);eq(restored.manualSubmission.openRequested,false);eq(restored.manualSubmission.approvedHosts,[]);eq(restored.manualSubmission.reopenConfirmedAt,undefined);eq(restored.report.journey,original.report.journey);
eq(current.state.applications.find(e=>e.id===b.task.requestId),before.state.applications.find(e=>e.id===b.task.requestId));eq(current.state.applications.find(e=>e.id===c.task.requestId),before.state.applications.find(e=>e.id===c.task.requestId));
eq((await a.event('poll',{report:unsent})).status,409);
r=await call('/api/application-agent/claim',{headers:worker,body:capabilities});eq(r.status,200);eq(r.data.task.requestId,a.task.requestId);assert.notEqual(r.data.task.claimId,a.task.claimId);checks++;
const recovered=r.data.task;eq(recovered.cv,a.task.cv);
r=await call(workerPath,{headers:worker,body:{requestId:recovered.requestId,claimId:recovered.claimId,id:randomUUID(),event:'ready',browserHealthVersion:1,browserSessionId:randomUUID(),report:unsent}});eq(r.status,200);eq(r.data.session.openRequested,false);eq(r.data.session.openCommandId,undefined);
// A worker-confirmed close is also automatically restored by heartbeat with the UI closed.
const d=await fixture('automatic-heartbeat');eq((await d.event('closed_before_submit',{report:unsent})).status,200);
await new Promise(resolve=>setTimeout(resolve,5200));
r=await call('/api/application-agent/heartbeat',{headers:worker,body:{state:'stopped'}});eq(r.status,200);eq((await call('/api/workspace')).data.state.applications.find(e=>e.id===d.task.requestId).status,'needs_attention');
r=await call('/api/application-agent/heartbeat',{headers:worker,body:{state:'running'}});eq(r.status,200);
current=(await call('/api/workspace')).data;eq(current.state.applications.find(e=>e.id===d.task.requestId).status,'queued');eq(current.state.applications.length,4);eq(current.state.applications.some(e=>e.status==='applied'),false);eq(current.state.attachments,before.state.attachments);
const rev=current.revision;eq((await call('/api/application-agent/heartbeat',{headers:worker,body:{state:'running'}})).status,200);eq((await call('/api/workspace')).data.revision,rev);
eq((await call('/api/application-agent/heartbeat',{headers:{...auth,Connection:'close'},body:{state:'running'}})).status,401);
console.log(`PASS ${checks} automatic browser recovery HTTP checks: read-only GET, owner POST and background heartbeat recovery, exact original file, same request, rotated claim, hidden replacement, no replay of opened/delivered forms, strict inputs and owner isolation. No employer contacted.`);
