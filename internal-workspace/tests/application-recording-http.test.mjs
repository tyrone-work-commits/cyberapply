import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
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

const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task;
const ids={requestId:task.requestId,claimId:task.claimId},query=new URLSearchParams(ids),uploadPath='/api/application-agent/recording?'+query,view='/api/applications/recordings?requestId='+task.requestId;
const bytes=Buffer.from('0000ftypiso6fixture-recording-media'),sha=createHash('sha256').update(bytes).digest('hex');
async function send(headers={}){const r=await fetch(base+uploadPath,{method:'POST',headers:{...worker,'Content-Type':'video/mp4','Content-Length':String(bytes.length),'X-Recording-Duration':'2','X-Recording-Started-At':new Date().toISOString(),'X-Recording-Partial':'false','X-Recording-SHA256':sha,...headers},body:bytes});return {status:r.status,data:await r.json()};}
eq((await call(uploadPath,{headers:worker})).data.saved,false);
eq((await send({'X-Recording-SHA256':'0'.repeat(64)})).status,400);
eq((await call(view)).data.items.length,0);
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'needs_attention',message:'Fictional recording test paused. No employer visited.',report:{unresolved:[{question:'Preferred shift?',field_type:'select',options:['Day','Night']}]}}})).status,200);
let r=await send();eq(r.status,200);eq(r.data.saved,true);eq((await send()).data.alreadySaved,true);eq((await send({'X-Recording-SHA256':'1'.repeat(64)})).status,409);
eq((await call(uploadPath,{headers:worker})).data.sha256,sha);
r=await call(view);eq(r.data.items.length,1);eq(r.data.items[0].attempt,task.claimId);eq(r.data.items[0].duration,2);
eq(r.data.currentAttempt,task.claimId);eq(r.data.applicationStatus,'needs_attention');eq(r.data.employer.title,'SOC Analyst');eq(r.data.employer.url,current.state.jobs[0].url);assert.ok(Number.isFinite(Date.parse(r.data.applicationUpdatedAt)));checks++;

const statusBody={...ids,state:'capturing',code:'',parts:0,partial:false};
eq((await call('/api/application-agent/recording-status',{method:'POST',headers:worker,body:statusBody})).status,200);
eq((await call(view)).data.status.state,'capturing');
eq((await call('/api/application-agent/recording-status',{method:'POST',headers:worker,body:{...statusBody,claimId:randomUUID()}})).status,409);
for(let part=0;part<2;part++){
 const r=await fetch(base+uploadPath+'&part='+part,{method:'POST',headers:{...worker,'Content-Type':'video/mp4','Content-Length':String(bytes.length),'X-Recording-Duration':'2','X-Recording-Started-At':new Date().toISOString(),'X-Recording-Partial':'false','X-Recording-SHA256':sha},body:bytes});eq(r.status,200);
}
r=await call(view);eq(r.data.items.length,1);eq(r.data.items[0].parts.length,3);eq(r.data.items[0].duration,6);
eq((await call(view+'&attempt='+task.claimId+'&part=0')).status,200);
eq((await call('/api/application-agent/recording-status',{method:'POST',headers:worker,body:{...statusBody,state:'interrupted',code:'runner_interrupted',parts:2,partial:true}})).status,200);
eq((await call(view)).data.status.state,'interrupted');
const media=view+'&attempt='+task.claimId;
r=await call(media);eq(r.status,200);assert.deepEqual(Buffer.from(r.data),bytes);checks++;eq(r.response.headers.get('cache-control'),'private, no-store');eq(r.response.headers.get('accept-ranges'),'bytes');
r=await call(media,{method:'HEAD'});eq(r.status,200);eq(r.response.headers.get('content-length'),String(bytes.length));eq(r.data.length,0);
for(const [range,start,end] of [['bytes=4-7',4,8],['bytes=8-',8,bytes.length],['bytes=-5',bytes.length-5,bytes.length]]){r=await call(media,{headers:{...auth,Range:range}});eq(r.status,206);assert.deepEqual(Buffer.from(r.data),bytes.subarray(start,end));checks++;}
for(const range of ['bytes=9999-','bytes=0-1,4-5','bytes=-0','bytes=5-2'])eq((await call(media,{headers:{...auth,Range:range}})).status,416);
const other={'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'};
eq((await call(view,{headers:other})).status,404);eq((await call(media,{headers:other})).status,404);eq((await call(view,{headers:{}})).status,401);eq((await call(uploadPath.replace(task.claimId,randomUUID()),{headers:worker})).status,409);
current=(await call('/api/workspace')).data;eq(current.state.applications[0].status,'needs_attention');
// Continue only this fictional known-unsent request; the prior recording stays historical.
await act({type:'answer_application_questions',applicationId:task.requestId,answers:[{question:'Preferred shift?',value:'Day'}],confirmation:'CONFIRMED',continueAgent:true});
r=await call(view);eq(r.data.applicationStatus,'queued');eq(r.data.currentAttempt,null);eq(r.data.items[0].attempt,task.claimId);
const resumed=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task;
eq(resumed.requestId,task.requestId);assert.notEqual(resumed.claimId,task.claimId);checks++;
eq(resumed.confirmedAnswers.find(answer=>answer.question==='Preferred shift?').value,'Day');
r=await call(view);eq(r.data.currentAttempt,resumed.claimId);eq(r.data.items.some(item=>item.attempt===resumed.claimId),false);
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{requestId:resumed.requestId,claimId:resumed.claimId,status:'uncertain',message:'Fictional Submit clicked; no employer was contacted.'}})).status,200);
const resumedQuery=new URLSearchParams({requestId:resumed.requestId,claimId:resumed.claimId});
r=await fetch(base+'/api/application-agent/recording?'+resumedQuery+'&part=0',{method:'POST',headers:{...worker,'Content-Type':'video/mp4','Content-Length':String(bytes.length),'X-Recording-Duration':'9','X-Recording-Started-At':new Date().toISOString(),'X-Recording-Partial':'false','X-Recording-SHA256':sha},body:bytes});eq(r.status,200);
eq((await call('/api/application-agent/recording-status',{method:'POST',headers:worker,body:{requestId:resumed.requestId,claimId:resumed.claimId,state:'saved',code:'',parts:1,partial:false}})).status,200);
r=await call(view);eq(r.data.currentAttempt,resumed.claimId);eq(r.data.applicationStatus,'uncertain');eq(r.data.status.attempt,resumed.claimId);eq(r.data.items.length,2);eq(r.data.items.find(item=>item.attempt===resumed.claimId).duration,9);
eq((await call(view+'&attempt='+resumed.claimId+'&part=0')).status,200);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,1);eq(current.state.applications[0].status,'uncertain');
await act({type:'clear_applications',confirmation:'CLEAR_APPLICATIONS'});eq((await call(media)).status,200);
r=await call('/api/applications/delete',{method:'POST',body:{revision:current.revision,scope:'cleared',confirmation:'PERMANENTLY DELETE'}});eq(r.status,200);eq((await call(media)).status,404);eq((await call(view)).status,404);
console.log(`PASS ${checks} recording HTTP checks: checksum/idempotency, post-outcome upload, private ownership, seeking, archive retention, permanent deletion, unchanged outcome.`);
