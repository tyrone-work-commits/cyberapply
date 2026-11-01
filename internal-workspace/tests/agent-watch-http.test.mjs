import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8792';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local isolated Worker only.');
const owner='watch-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'watch@example.test'};let checks=0;
const eq=(a,b)=>{assert.equal(a,b);checks++;};
async function call(path,{method='GET',body,headers=auth}={}){const response=await fetch(base+path,{signal:AbortSignal.timeout(12000),method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const type=response.headers.get('content-type')||'';const data=type.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer());if(response.status>=500)console.error(path,response.status,data);return {response,status:response.status,data};}
let current=(await call('/api/workspace')).data;
async function act(action){const r=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
await act({type:'complete_onboarding',fullName:'Watch QA',headline:'SOC analyst',targetRole:'SOC Analyst'});
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Watch QA\nwatch@example.test\nEXPERIENCE\nSOC Analyst 2023 - 2025\nInvestigated alerts.'],'watch-qa.txt',{type:'text/plain'}));current=(await call('/api/files',{method:'POST',body:upload})).data;
const paired=await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(paired.status,200);const worker={Authorization:'Bearer '+JSON.parse(paired.data.token).token};current=(await call('/api/workspace')).data;
await act({type:'add_job',title:'SOC Analyst',company:'Watch fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner,description:'Fictional live viewer fixture. No employer contact.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
const id=current.state.applications[0].id,path='/api/applications/watch?requestId='+encodeURIComponent(id);
let result=await call(path,{method:'POST',body:{}});eq(result.status,200);eq(result.data.status,'queued');eq((await call(path)).status,204);
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task;const ids={requestId:task.requestId,claimId:task.claimId};
// The queued lease cannot authorize a different, newly claimed browser session.
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:ids})).data.watching,false);
result=await call(path,{method:'POST',body:{}});eq(result.data.status,'processing');eq(result.data.active,true);
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:ids})).data.watching,true);
const frame=Buffer.from([255,216,1,2,3,255,217]).toString('base64');
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,frame}})).status,200);
result=await call(path);eq(result.status,200);eq(result.response.headers.get('content-type'),'image/jpeg');eq(result.response.headers.get('cache-control'),'private, no-store');eq(result.response.headers.get('cross-origin-resource-policy'),'same-origin');assert.deepEqual([...result.data],[255,216,1,2,3,255,217]);checks++;
await new Promise(resolve=>setTimeout(resolve,12500));eq((await call(path)).status,204);
await call(path,{method:'POST',body:{}});await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,frame}});
const other={'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'};
eq((await call(path,{headers:other})).status,404);eq((await call(path,{headers:{}})).status,401);eq((await call(path,{method:'POST',body:{},headers:{...auth,Origin:'https://other.example'}})).status,403);
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,claimId:randomUUID(),frame}})).status,409);
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,frame:Buffer.from('not JPEG').toString('base64')}})).status,400);
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,frame:'a'.repeat(325001)}})).status,413);
await new Promise(resolve=>setTimeout(resolve,21000));eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:ids})).data.watching,false);
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,stop:true}})).data.watching,false);eq((await call(path)).status,204);
// Opening/closing a viewer must not alter application state or create a retry.
current=(await call('/api/workspace')).data;eq(current.state.applications.length,1);eq(current.state.applications[0].status,'processing');
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'needs_attention',message:'Fictional viewer test complete; no employer visited.'}})).status,200);
result=await call(path,{method:'POST',body:{}});eq(result.data.active,false);eq((await call(path)).status,204);
eq((await call('/api/application-agent/watch',{method:'POST',headers:worker,body:{...ids,frame}})).status,409);
console.log(`PASS ${checks} private live-view HTTP checks: owner isolation, viewer lease, exact claim binding, safe image response, bounds, cleanup and no application retry.`);
