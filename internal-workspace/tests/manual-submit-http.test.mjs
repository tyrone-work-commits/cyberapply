import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8796';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated loopback Worker only.');
const owner='handoff-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'handoff@example.test'};let current,checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function call(path,{method='GET',body,headers=auth}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.status>=500)console.error(path,r.status,data);return{status:r.status,data};}
async function act(action){const r=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
current=(await call('/api/workspace')).data;await act({type:'complete_onboarding',fullName:'Fictional Handoff Applicant',headline:'SOC analyst',targetRole:'SOC Analyst'});
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Fictional Handoff Applicant\nhandoff@example.test\nEXPERIENCE\nInvestigated security alerts and documented incidents.'],'handoff-fixture.txt',{type:'text/plain'}));const up=await call('/api/files',{method:'POST',body:upload});eq(up.status,200);current=up.data;
const pair=await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(pair.status,200);const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};current=(await call('/api/workspace')).data;
await act({type:'add_job',title:'Fictional SOC Analyst',company:'Handoff fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner,description:'Isolated fixture; no employer contact.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
eq((await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:1,verificationHandoffVersion:2}})).status,409);
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:4,verificationHandoffVersion:2}})).data.task,ids={requestId:task.requestId,claimId:task.claimId},id=randomUUID();

const workerPath='/api/application-agent/manual-submit',ownerPath='/api/applications/manual-submit',query='?requestId='+task.requestId;
const begin={...ids,id,event:'ready',browserHealthVersion:1,browserSessionId:randomUUID(),challengeHosts:['www.google.com'],report:{journey:{version:1,submit_click_attempts:0,possible_delivery:false}}};
eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,challengeHosts:['evil.test']}})).status,409);
let r=await call(workerPath,{method:'POST',headers:worker,body:begin});eq(r.status,200);eq(r.data.session.state,'ready');eq(r.data.session.expiresAt,undefined);
eq((await call(workerPath,{method:'POST',headers:worker,body:begin})).data.session.id,id);
eq((await call(ownerPath+query,{headers:{}})).status,401);
eq((await call(ownerPath+query,{headers:{'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'}})).status,404);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...begin,id:randomUUID()}})).status,409);
async function command(command,extra={}){return call(ownerPath,{method:'POST',body:{requestId:task.requestId,id,command,...extra}});}
eq((await command('open',{openConfirmed:true,approvedHosts:['evil.test']})).status,409);
eq((await command('open',{approvedHosts:['www.google.com']})).status,409);
eq((await command('open',{openConfirmed:false,approvedHosts:['www.google.com']})).status,409);
eq((await command('open',{openConfirmed:true,approvedHosts:[]})).status,409);
eq((await command('open',{openConfirmed:true,approvedHosts:['www.google.com']})).status,200);
r=await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}});eq(r.data.session.openRequested,true);eq(r.data.session.approvedHosts,['www.google.com']);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.openRequested,false);
eq((await command('open')).status,409);
eq((await command('open',{openConfirmed:true})).status,200);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.openRequested,true);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.openRequested,false);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'needs_submit'}})).data.session.state,'needs_submit');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'confirmed'}})).status,409);
// Owner-observed error is metadata only and survives an older worker's Ready/poll.
eq((await command('report_processing_error')).status,200);
r=await call(workerPath,{method:'POST',headers:worker,body:{...begin,event:'ready'}});eq(r.data.session.state,'needs_submit');eq(r.data.session.processingError.source,'owner');
current=(await call('/api/workspace')).data;eq(current.state.applications[0].status,'processing');assert.match(current.state.applications[0].result.message,/processing error/);checks++;
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'processing_error',submissionHttpStatus:428}})).data.session.processingError.httpStatus,428);
eq((await command('restore',{openConfirmed:true,closedBeforeSubmitConfirmed:true})).status,409);
// A visible code prompt is a human verification step, never a receipt or a new submission.
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'email_verification',code:'MUST_NOT_BE_ACCEPTED'}})).status,400);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'email_verification'}})).data.session.verificationStage,'email_code');
r=await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'ready'}});eq(r.data.session.verificationStage,'email_code');
current=(await call('/api/workspace')).data;eq(current.state.applications[0].status,'processing');assert.match(current.state.applications[0].result.message,/emailed verification code/);checks++;
eq((await command('cancel')).data.session.state,'cancel_requested');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'processing_error',submissionHttpStatus:428}})).data.session.state,'cancel_requested');
// A genuine receipt wins a cancellation race, but no request is queued/retried.
const evidence={url:'https://fixture.example/confirmation',text:'Thank you for applying'};
r=await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'confirmed',evidence}});eq(r.status,200);eq(r.data.session.state,'confirmed');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'confirmed',evidence}})).status,200);
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'applied',message:'Confirmed',receipt:evidence.text,evidence,report:{journey:{version:1,submit_click_attempts:0,possible_delivery:true}}}})).status,200);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,1);eq(current.state.applications[0].status,'applied');eq(current.state.applications[0].claim.id,task.claimId);eq(current.state.applications[0].report.journey.submit_click_attempts,0);
// Once confirmation is saved, old polling/closure/results are acknowledgements only.
eq((await call(workerPath+query+'&claimId='+task.claimId,{headers:worker})).data.session.state,'confirmed');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'poll'}})).data.session.state,'confirmed');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id,event:'cancelled'}})).data.session.state,'confirmed');
eq((await call(workerPath,{method:'POST',headers:worker,body:{...ids,id:randomUUID(),event:'poll'}})).status,409);
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...ids,status:'uncertain',message:'Late closed-browser result',report:{journey:{version:1,possible_delivery:false},manual_submission:{state:'cancelled'}}}})).status,200);
current=(await call('/api/workspace')).data;eq(current.state.applications[0].status,'applied');eq(current.state.applications[0].result.evidence,evidence);eq(current.state.applications[0].report.manual_submission.state,'confirmed');eq(current.state.applications[0].report.journey.possible_delivery,true);
eq((await command('cancel')).status,409);
// An accidentally closed, positively unsent form stays Ready; only an explicit
// checkbox + Reopen can reprepare the SAME request and original CV. No employer contacted.
await act({type:'add_job',title:'Fictional second SOC Analyst',company:'Closed fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/closed/'+owner,description:'Isolated closure fixture.',skills:[]});await act({type:'decide_job',jobId:current.state.jobs.find(j=>j.company==='Closed fixture').id,decision:'apply'});
const claim=()=>call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:4,verificationHandoffVersion:2}});
const next=(await claim()).data.task,closedId=randomUUID(),closedIds={requestId:next.requestId,claimId:next.claimId};
const unsent={journey:{version:1,continue_click_attempts:0,submit_click_attempts:0,possible_delivery:false,manual_submit_observed:false,human_submit_observed:0},manual_submission:{policy:'user_final_submit',human_submit_observed:0,state:'ready'}};
const event=(event,extra={})=>call(workerPath,{method:'POST',headers:worker,body:{...closedIds,id:closedId,event,...extra}});
eq((await event('ready',{challengeHosts:['www.google.com'],report:unsent})).status,200);
eq((await event('closed_before_submit',{report:{...unsent,journey:{...unsent.journey,human_submit_observed:1}}})).status,409);
eq((await event('closed_before_submit',{report:unsent})).data.session.state,'closed_before_submit');
eq((await event('closed_before_submit',{report:unsent})).status,200);
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{...closedIds,status:'needs_attention',message:'Closed before submit',report:unsent}})).status,200);
eq((await call(ownerPath+'?requestId='+next.requestId)).data.session.state,'closed_before_submit');eq((await claim()).data.task,null);
const reopen=extra=>call(ownerPath,{method:'POST',body:{requestId:next.requestId,id:closedId,command:'open',openConfirmed:true,approvedHosts:['www.google.com'],...extra}});
eq((await reopen({})).status,409);eq((await reopen({closedBeforeSubmitConfirmed:false})).status,409);
eq((await reopen({closedBeforeSubmitConfirmed:true})).data.session.state,'reopening');
eq((await reopen({closedBeforeSubmitConfirmed:true})).status,409);
const restarted=(await claim()).data.task;eq(restarted.requestId,next.requestId);assert.notEqual(restarted.claimId,next.claimId);checks++;eq(restarted.cv,next.cv);
const fresh={requestId:restarted.requestId,claimId:restarted.claimId,id:randomUUID()};
r=await call(workerPath,{method:'POST',headers:worker,body:{...fresh,event:'ready',challengeHosts:['www.google.com'],report:unsent}});eq(r.status,200);eq(r.data.session.openRequested,true);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...fresh,event:'poll'}})).data.session.openRequested,false);
current=(await call('/api/workspace')).data;eq(current.state.applications.length,2);eq(current.state.applications.find(a=>a.id===next.requestId).cv.fileId,current.state.applications.find(a=>a.id===task.requestId).cv.fileId);
eq((await call(ownerPath,{method:'POST',body:{requestId:next.requestId,id:fresh.id,command:'cancel'}})).status,200);
eq((await call(workerPath,{method:'POST',headers:worker,body:{...fresh,event:'cancelled',report:unsent}})).status,200);
eq((await call(ownerPath+'?requestId='+next.requestId)).data.session,null);
// Older workers must never claim jobs under the retired automatic final-submit policy.
eq((await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).status,409);
eq((await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:2,verificationHandoffVersion:2}})).status,409);
eq((await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:5,manualSubmitVersion:3,verificationHandoffVersion:2}})).status,409);
console.log(`PASS ${checks} persistent manual-submit HTTP checks: owner/claim isolation, explicit native CAPTCHA access, idempotent state and confirmation, cancellation race, report preservation and old-runner rejection.`);
