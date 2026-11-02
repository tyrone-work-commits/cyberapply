import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dir='.sites-runtime/question-tests';await mkdir(dir,{recursive:true});
for(const name of ['features','candidate-facts','cover-letter','cyber-domain','employer-questions','application-agent-state','application-deletion'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {rememberEmployerQuestions}=await import('../'+dir+'/employer-questions.mjs');const {emptyState,reduceAction,actionSchema,applicationProfile}=await import('../'+dir+'/cyber-domain.mjs');const {deletionHistoryExpression}=await import('../'+dir+'/application-deletion.mjs');
const at='2026-11-01T15:00:00Z';const request={id:'request-one',jobId:'one',cvSha256:'a'.repeat(64)};
const {draftEmployerProse}=await import('../'+dir+'/employer-questions.mjs');

test('PDF-wrapped statements become complete prose without absorbing headings or later bullets',()=>{
 const cv='PROFESSIONAL EXPERIENCE\n• Built secure Python services, integrating secure\ncoding practices across the development lifecycle.\n• Implemented role-based access control\nfor application users.\nPROJECTS\nRegistry System\nGitHub: https://example.test/project\nBuilt a Django-based records system with a focus on access control, and\ncompliance for document approvals.\nTechnologies: Python, Django';
 const job={title:'Security Engineer',company:'Fixture',description:'Python services integrating secure coding practices across the development lifecycle. Django records system compliance document approvals.',skills:['Python','Django']};
 for(const question of ['Why are you interested in this role?','Is there anything else you would like us to know?']){
  const r=draftEmployerProse(question,'textarea',cv,job);
  assert.match(r.answer,/integrating secure coding practices across the development lifecycle\./);
  assert.doesNotMatch(r.answer,/secure Built|and I would|PROJECTS|GitHub:|Technologies:/);
  assert.match(r.answer,/\n\nI built/);assert.match(r.evidence,/access control, and compliance for document approvals\./);
 }
});

test('a dangling CV fragment is not promoted into a completed work claim',()=>{
 const r=draftEmployerProse('Why this role?','textarea','Built a secure service with',{title:'Security Engineer',company:'Fixture',description:'Security',skills:[]});
 assert.equal(r.answer,'');assert.match(r.reason,/enough work evidence/);
});

test('action words in skills metadata are not converted into work claims',()=>{
 const cv='TECHNICAL SKILLS\nSecured Frameworks: Django, FastAPI, React\nDatabases & Data Security: PostgreSQL (secure\nconfigurations, parameterized queries)\nManaged Platforms: GitHub, Vercel\nEXPERIENCE\n• Built secure Python applications.\n• Implemented role-based access control.';
 const r=draftEmployerProse('Why this role?','textarea',cv,{title:'Engineer',company:'Fixture',description:'Secured frameworks databases security managed platforms Python access control',skills:['Python']});
 assert.match(r.answer,/I built secure Python applications\./);assert.doesNotMatch(r.answer,/I secured Frameworks|Databases &|I managed Platforms|parameterized queries/);
});
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

function draftState(){const s=state();s.selectedCvId='cv';s.attachments=[{id:'cv',name:'fixture.txt'}];s.resumeReview={source:{fileId:'cv'}};s.profile.resumeText='QA\nSOC Analyst 2023 - 2025\nInvestigated security alerts using Splunk.\nBuilt Python monitoring tools.';s.profile.skills=['Splunk','Python'];s.jobs=[{id:'one',title:'SOC Analyst',company:'Fixture',description:'Monitor Splunk alerts and investigate incidents.',skills:['Splunk']}];return s;}
test('bulk drafts open-ended questions using chosen-CV evidence, preserving manual answers and facts',()=>{
 let s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea'},{question:'Describe your strengths',field_type:'textarea'},{question:'City',field_type:'text'}]},at);
 const manual=s.accountProfile.employerQuestions.find(q=>q.question==='Describe your strengths');s=reduceAction(s,{type:'save_employer_answer',questionId:manual.id,answer:'My own saved response'},'interface',at).state;
 const result=reduceAction(s,actionSchema.parse({type:'draft_employer_answers'}),'interface',at);const draft=result.state.accountProfile.employerQuestions.find(q=>q.question==='Why this role?');assert.equal(draft.aiDraft,true);assert.equal(draft.source,'cv_and_job');assert.match(draft.answer,/Splunk/);assert.match(draft.evidence,/Investigated/);assert.equal(result.state.accountProfile.employerQuestions.find(q=>q.id===manual.id).answer,'My own saved response');assert.equal(result.state.accountProfile.employerQuestions.find(q=>q.question==='City').answer,'');assert.equal(result.state.applications?.length||0,0);
});
test('ordinary no-AI wording no longer blocks generated profile drafts',()=>{
 let s=draftState();const q='Why this role? Please do not use AI/ChatGPT for any part of this application.';rememberEmployerQuestions(s,request,{questions:[{question:q,field_type:'textarea'}],answers:[{question:q,value:'Old generated draft',source:'cv_and_job'}]},at);
 s=reduceAction(s,{type:'draft_employer_answers'},'interface',at).state;const item=s.accountProfile.employerQuestions[0];assert.match(item.answer,/Splunk/);assert.equal(item.generationNote,'');assert.equal(item.aiDraft,true);assert.equal(item.status,'answered');
});
test('draft generation refuses a missing or mismatched selected CV',()=>{const s=draftState();s.resumeReview.source.fileId='another';assert.throws(()=>reduceAction(s,{type:'draft_employer_answers'},'interface',at),/Select and review/);});

test('a generated draft retains its provenance when saved for reuse, and unsupported experience stays unanswered',()=>{
 let s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea'},{question:'Describe your experience with Kubernetes',field_type:'textarea'}]},at);
 s=reduceAction(s,{type:'draft_employer_answers'},'interface',at).state;const q=s.accountProfile.employerQuestions.find(q=>q.question==='Why this role?');s=reduceAction(s,{type:'save_employer_answer',questionId:q.id,answer:q.answer},'interface',at).state;
 assert.equal(s.accountProfile.employerQuestions.find(q=>q.question==='Why this role?').aiDraft,true);assert.equal(s.accountProfile.employerQuestions.find(q=>q.question.includes('Kubernetes')).answer,'');
});

test('an explicit per-question generation can replace a saved answer while bulk generation preserves it',()=>{
 let s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea'}]},at);const id=s.accountProfile.employerQuestions[0].id;s=reduceAction(s,{type:'save_employer_answer',questionId:id,answer:'My older answer'},'interface',at).state;
 assert.equal(reduceAction(s,{type:'draft_employer_answers'},'interface',at).state.accountProfile.employerQuestions[0].answer,'My older answer');
 s=reduceAction(s,{type:'draft_employer_answers',questionId:id},'interface',at).state;assert.match(s.accountProfile.employerQuestions[0].answer,/Splunk/);assert.equal(s.accountProfile.employerQuestions[0].aiDraft,true);
});
test('authorship declarations remain manual references, distinct from ordinary no-AI wording',()=>{
 let s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Did you use AI for this application?',field_type:'select',options:['Yes','No']}]},at);
 s=reduceAction(s,{type:'save_employer_answer',questionId:s.accountProfile.employerQuestions[0].id,answer:'No'},'interface',at).state;assert.equal(s.accountProfile.employerQuestions[0].reusePolicy,'manual_only');
});

test('new options enrich a saved answer without replacing it or erasing choices on an empty report',()=>{
 let s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Which schedule suits you?',field_type:'combobox'}]},at);
 const id=s.accountProfile.employerQuestions[0].id;s=reduceAction(s,{type:'save_employer_answer',questionId:id,answer:'Flexible'},'interface',at).state;
 rememberEmployerQuestions(s,request,{questions:[{question:'Which schedule suits you?',field_type:'select',options:['Day','Night']}]},at);
 assert.equal(s.accountProfile.employerQuestions.length,1);const q=s.accountProfile.employerQuestions[0];assert.equal(q.answer,'Flexible');assert.deepEqual(q.options,['Day','Night']);assert.equal(q.optionsCompany,'Fixture');
 rememberEmployerQuestions(s,request,{questions:[{question:q.question,field_type:'combobox',options:[]}]},at);assert.deepEqual(s.accountProfile.employerQuestions[0].options,['Day','Night']);
});

test('captured automation choices classify a reference without asserting a human answer',()=>{
 const s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Which best describes you?',field_type:'combobox',options:['I am an AI, bot, or automated program.','I am a human.']}]},at);
 const q=s.accountProfile.employerQuestions[0];assert.equal(q.answer,'');assert.equal(q.reusePolicy,'manual_only');assert.equal(q.status,'needs_details');
});

test('metadata-only refresh preserves generated prose and application records',()=>{
 let s=draftState();rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea'}],answers:[{question:'Why this role?',value:'My existing draft',source:'cv_and_job'}]},at);
 const before=structuredClone(s);rememberEmployerQuestions(s,request,{questions:[{question:'Why this role?',field_type:'textarea',options:[]},{question:'Preferred shift?',field_type:'combobox',options:['Day','Night']}]},at,true);
 assert.equal(s.accountProfile.employerQuestions.find(q=>q.question==='Why this role?').answer,'My existing draft');assert.deepEqual(s.applications,before.applications);assert.equal(s.accountProfile.employerQuestions.find(q=>q.question==='Preferred shift?').answer,'');
});
