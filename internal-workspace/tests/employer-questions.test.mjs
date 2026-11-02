import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dir='.sites-runtime/question-tests';await mkdir(dir,{recursive:true});
for(const name of ['features','candidate-facts','cover-letter','cyber-domain','employer-questions','application-agent-state','application-deletion'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {rememberEmployerQuestions}=await import('../'+dir+'/employer-questions.mjs');const {emptyState,reduceAction,actionSchema,applicationProfile}=await import('../'+dir+'/cyber-domain.mjs');const {deletionHistoryExpression}=await import('../'+dir+'/application-deletion.mjs');
const at='2026-11-01T15:00:00Z';const request={id:'request-one',jobId:'one',cvSha256:'a'.repeat(64)};
function state(){const s=emptyState();s.accountProfile={fullName:'QA',headline:'',targetRole:'SOC',completedAt:at};return s;}
const report=()=>({questions:[{question:'Why this role?',field_type:'textarea'},{question:'Have you worked with Kubernetes?',field_type:'select',options:['Yes','No']}],answers:[{question:'Why this role?',field_type:'textarea',value:'I would use the incident response work in my CV.',source:'cv_and_job',evidence:'Investigated security alerts.'}],unresolved:[{question:'Have you worked with Kubernetes?'}]});
test('encountered questions persist both grounded answers and missing facts with source evidence',()=>{const s=state(),r=report();rememberEmployerQuestions(s,request,r,at);assert.equal(s.accountProfile.employerQuestions.length,2);const prose=s.accountProfile.employerQuestions.find(q=>q.question==='Why this role?');assert.equal(prose.source,'cv_and_job');assert.equal(prose.jobSpecific,true);assert.equal(s.accountProfile.employerQuestions[0].status,'needs_details');assert.deepEqual(applicationProfile(s).employerQuestions,s.accountProfile.employerQuestions);});
test('an explicit profile answer is reusable and not overwritten by later automatic reports',()=>{let s=state();rememberEmployerQuestions(s,request,report(),at);const q=s.accountProfile.employerQuestions[0];s=reduceAction(s,actionSchema.parse({type:'save_employer_answer',questionId:q.id,answer:'Yes'}),'interface',at).state;rememberEmployerQuestions(s,{...request,id:'later'},report(),at);const saved=s.accountProfile.employerQuestions.find(x=>x.id===q.id);assert.equal(saved.source,'user');assert.equal(saved.answer,'Yes');assert.equal(saved.originRequestId,undefined);});
test('consent answers can be edited as references without authorizing employer consent',()=>{let s=state();rememberEmployerQuestions(s,request,{questions:[{question:'I agree to privacy terms',field_type:'checkbox'}]},at);s=reduceAction(s,{type:'save_employer_answer',questionId:s.accountProfile.employerQuestions[0].id,answer:'Yes'},'interface',at).state;assert.equal(s.accountProfile.employerQuestions[0].answer,'Yes');assert.equal(s.accountProfile.employerQuestions[0].reusePolicy,'manual_only');});
test('credentials and unlabelled helper inputs are not saved; oversized memory cannot lose an application result',()=>{const s=state();rememberEmployerQuestions(s,request,{questions:[{question:'Password',field_type:'password'},{question:'Unlabelled field',field_type:'text'}]},at);assert.equal(s.accountProfile.employerQuestions.length,0);s.profile.resumeText='x'.repeat(1770000);const r=report();rememberEmployerQuestions(s,request,r,at);assert.ok(r.answerMemory.omitted>0);});
test('history deletion removes learned copies but preserves independent user answers and missing-profile shape',async()=>{const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE test(payload TEXT)');const s=state();rememberEmployerQuestions(s,request,report(),at);s.accountProfile.employerQuestions.push({...s.accountProfile.employerQuestions[0],id:'user',source:'user',originRequestId:undefined});db.prepare('INSERT INTO test VALUES (?)').run(JSON.stringify(s));const q=deletionHistoryExpression(['request-one'],[],false);const row=db.prepare(`SELECT ${q.expression} AS value FROM test`).get(...q.params);assert.deepEqual(JSON.parse(row.value).accountProfile.employerQuestions.map(q=>q.id),['user']);db.prepare('UPDATE test SET payload=?').run(JSON.stringify(emptyState()));const noProfile=db.prepare(`SELECT ${q.expression} AS value FROM test`).get(...q.params);assert.equal(JSON.parse(noProfile.value).accountProfile,undefined);db.close();});

test('automation reference answers remain editable but cannot become automatic verification',()=>{
 let s=state();const question='Which of the following best describes you?';
 rememberEmployerQuestions(s,request,{questions:[{question,field_type:'combobox',options:['I am an AI, bot, or automated program.','I am a human.']}]},at);
 const q=s.accountProfile.employerQuestions[0];s=reduceAction(s,{type:'save_employer_answer',questionId:q.id,answer:'I am a human.'},'interface',at).state;
 assert.equal(s.accountProfile.employerQuestions[0].answer,'I am a human.');assert.equal(s.accountProfile.employerQuestions[0].reusePolicy,'manual_only');
});
test('all saved factual sources are editable without altering general profile values',()=>{
 let s=state();s.accountProfile.city='Abuja';rememberEmployerQuestions(s,request,{questions:[{question:'City',field_type:'text'}],answers:[{question:'City',value:'Abuja',source:'edit_profile',evidence:'Saved city'}]},at);
 const q=s.accountProfile.employerQuestions[0];s=reduceAction(s,{type:'save_employer_answer',questionId:q.id,answer:'Lagos'},'interface',at).state;
 assert.equal(s.accountProfile.employerQuestions[0].answer,'Lagos');assert.equal(s.accountProfile.employerQuestions[0].reusePolicy,'exact_question');assert.equal(s.accountProfile.city,'Abuja');
});
test('saved salary and contextual eligibility answers are reusable across employers',()=>{
 let s=state();rememberEmployerQuestions(s,request,{questions:[{question:'Expected yearly salary USD',field_type:'number'},{question:'Do you need sponsorship for this role?',field_type:'select'}]},at);
 for(const item of [...s.accountProfile.employerQuestions]){s=reduceAction(s,{type:'save_employer_answer',questionId:item.id,answer:item.fieldType==='number'?'90000':'No'},'interface',at).state;assert.equal(s.accountProfile.employerQuestions.find(q=>q.id===item.id).reusePolicy,'exact_question');}
});

test('more than forty questions remain available and earlier user edits survive new reports',()=>{
 let s=state();const rows=Array.from({length:85},(_,i)=>({question:`Optional employer question ${i}?`,field_type:'text'}));
 rememberEmployerQuestions(s,request,{questions:rows},at);assert.equal(s.accountProfile.employerQuestions.length,85);
 const first=s.accountProfile.employerQuestions.find(q=>q.question===rows[0].question);s=reduceAction(s,{type:'save_employer_answer',questionId:first.id,answer:'My edited answer'},'interface',at).state;
 rememberEmployerQuestions(s,request,{questions:[...rows,{question:'Another optional question?',field_type:'text'}]},at);
 assert.equal(s.accountProfile.employerQuestions.length,86);assert.equal(s.accountProfile.employerQuestions.find(q=>q.id===first.id).answer,'My edited answer');
});
test('a saved answer is preserved when a different employer reports the same question',()=>{
 let s=state();rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea'}]},at);
 const q=s.accountProfile.employerQuestions[0];s=reduceAction(s,{type:'save_employer_answer',questionId:q.id,answer:'I enjoy security investigations.'},'interface',at).state;
 rememberEmployerQuestions(s,{...request,jobId:'two'},{questions:[{question:'Why this role?*',field_type:'text'}]},at);
 assert.equal(s.accountProfile.employerQuestions.length,1);assert.equal(s.accountProfile.employerQuestions[0].jobSpecific,false);assert.equal(s.accountProfile.employerQuestions[0].answer,'I enjoy security investigations.');
});
test('saving synchronizes legacy copies across jobs and compatible controls without changing personal facts',()=>{
 let s=state();s.accountProfile.city='Abuja';rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea'}]},at);const first=s.accountProfile.employerQuestions[0];
 s.accountProfile.employerQuestions.push({...first,id:'old-other-job',question:'Why this role?*',fieldType:'text',jobId:'two',source:'user',answer:'An older answer',reusePolicy:'job_only'});
 s=reduceAction(s,{type:'save_employer_answer',questionId:first.id,answer:'My reusable answer'},'interface',at).state;
 assert.equal(s.accountProfile.employerQuestions.length,2);for(const q of s.accountProfile.employerQuestions){assert.equal(q.answer,'My reusable answer');assert.equal(q.jobSpecific,false);assert.equal(q.reusePolicy,'exact_question');assert.equal(q.originRequestId,undefined);}
 assert.equal(s.accountProfile.city,'Abuja');
});
test('a full workspace retains old answers and reports new-question storage omissions',()=>{
 const s=state();rememberEmployerQuestions(s,request,report(),at);const before=structuredClone(s.accountProfile.employerQuestions);s.profile.resumeText='x'.repeat(1770000);
 const r={questions:[{question:'A new question?',field_type:'text'}]};rememberEmployerQuestions(s,request,r,at);assert.deepEqual(s.accountProfile.employerQuestions,before);assert.equal(r.answerMemory.omitted,1);
});
