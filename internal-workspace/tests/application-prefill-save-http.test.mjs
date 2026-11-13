import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
// Run application-answer-prefill.test.mjs first to compile the same pure UI resolver.
const {applicationAnswerPrefill}=await import('../.sites-runtime/application-answer-prefill-tests/application-answer-prefill.mjs');
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8796';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated loopback Worker only.');
const owner='prefill-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'prefill@example.test'};let current,checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function call(path,{method='GET',body,headers=auth}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
async function act(action){const r=await call('/api/workspace',{method:'POST',body:{revision:current.revision,action}});eq(r.status,200);current=r.data;}
current=(await call('/api/workspace')).data;
await act({type:'complete_onboarding',fullName:'Fictional Prefill Applicant',headline:'SOC analyst',targetRole:'SOC Analyst',country:'USA'});
const upload=new FormData();upload.set('revision',String(current.revision));upload.set('file',new File(['Fictional Prefill Applicant\nprefill@example.test\nLinkedIn: https://www.linkedin.com/in/fictional-prefill\nEXPERIENCE\nInvestigated security alerts and documented incidents.'],'prefill-fixture.txt',{type:'text/plain'}));const uploaded=await call('/api/files',{method:'POST',body:upload});eq(uploaded.status,200);current=uploaded.data;
const pair=await call('/api/application-agent/pair',{method:'POST',body:{enabled:true,confirmation:'AUTHORIZE_CV_APPLICATIONS'}});eq(pair.status,200);const worker={Authorization:'Bearer '+JSON.parse(pair.data.token).token};current=(await call('/api/workspace')).data;
await act({type:'add_job',title:'Fictional SOC Analyst',company:'Prefill fixture',location:'Remote',workMode:'Remote',url:'https://fixture.example/'+owner,description:'Isolated fictional employer; no contact or real submission.',skills:[]});
await act({type:'decide_job',jobId:current.state.jobs[0].id,decision:'apply'});
const task=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task;
const questions=[{question:'Country',field_type:'select',source:'edit_profile',options:['United States','Canada']},{question:'Preferred shift?',field_type:'select',options:['Day','Night']},{question:'LinkedIn profile',field_type:'text'}];
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{requestId:task.requestId,claimId:task.claimId,status:'needs_attention',message:'Fictional known-unsent prefill fixture.',report:{questions,unresolved:questions}}})).status,200);
current=(await call('/api/workspace')).data;const shift=current.state.accountProfile.employerQuestions.find(q=>q.question==='Preferred shift?');await act({type:'save_employer_answer',questionId:shift.id,answer:'Night'});
const request=current.state.applications[0],bank=current.state.accountProfile.employerQuestions;
const proposed=questions.map(question=>({question:question.question,...applicationAnswerPrefill(request,question,{isDropdown:question.field_type==='select',options:question.options||[]},bank,current.state.accountProfile)}));
eq(proposed.map(item=>item.value),['United States','Night','https://www.linkedin.com/in/fictional-prefill']);eq(proposed.map(item=>item.source),['profile','library','cv']);
// The user changes an offered choice before approving, without changing profile facts.
await act({type:'answer_application_questions',applicationId:request.id,answers:proposed.map(item=>({question:item.question,value:item.question==='Preferred shift?'?'Day':item.value})),confirmation:'CONFIRMED',continueAgent:true});
eq(current.state.applications.length,1);eq(current.state.applications[0].status,'queued');eq(current.state.accountProfile.country,'USA');
eq(current.state.applications[0].confirmedAnswers.find(item=>item.question==='Preferred shift?').value,'Day');
const library=(await call('/api/application-actions')).data.answers;eq(library.find(item=>item.question==='Preferred shift?').answer,'Day');eq(library.find(item=>item.question==='Country').answer,'United States');eq(library.find(item=>item.question==='LinkedIn profile').answer,'https://www.linkedin.com/in/fictional-prefill');
const resumed=(await call('/api/application-agent/claim',{method:'POST',headers:worker,body:{profileAnswersVersion:4}})).data.task;eq(resumed.requestId,request.id);eq(resumed.cv.id,task.cv.id);eq(resumed.confirmedAnswers.find(item=>item.question==='Preferred shift?').value,'Day');
eq((await call('/api/application-agent/result',{method:'POST',headers:worker,body:{requestId:resumed.requestId,claimId:resumed.claimId,status:'needs_attention',message:'Isolated prefill/save test finished. No employer contacted.'}})).status,200);
console.log(`PASS ${checks} prefill/save HTTP checks: profile/library/chosen-CV proposals, changed offered answer, durable library/application save and same-request continuation; no real employer contact.`);
