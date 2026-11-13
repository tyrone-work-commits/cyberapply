import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/form-question-tests';await mkdir(dir,{recursive:true});
for(const name of ['features','candidate-facts','cover-letter','employer-location-choices','employer-questions','application-form-questions','application-question-choices','cyber-domain'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {applicationFormQuestions,canEditApplicationQuestions,applicationAnswerStage,applicationVerificationQuestions,applicationAnswerSave}=await import('../'+dir+'/application-form-questions.mjs');
const {emptyState:baseState,reduceAction,actionSchema}=await import('../'+dir+'/cyber-domain.mjs');
const at='2026-11-07T12:00:00Z';
test('answer save acknowledgement survives a report replacement and reload without implying submission',()=>{
 const s=emptyState();s.applications=[fixture()];
 const saved=saveAnswers(s,[{question:'Preferred shift?',value:'Night'}]).state;
 assert.deepEqual(saved.applications[0].answerSave,{at,count:1});
 saved.applications[0].report={unresolved:[{question:'Are you human?',source:'verification'}]};
 saved.applications[0].result={at:'2026-11-07T12:01:00Z',message:'A separate verification is required.'};
 const reloaded=JSON.parse(JSON.stringify(saved));assert.deepEqual(applicationAnswerSave(reloaded.applications[0]),{at,count:1});
 assert.equal(reloaded.applications[0].status,'needs_action');assert.equal(reloaded.applications[0].result.receipt,undefined);
 reloaded.attachments=[{id:'receipt-cv',key:'fixture',name:'fictional.txt',type:'text/plain',size:100,createdAt:at}];reloaded.selectedCvId='receipt-cv';
 reloaded.drafts=[{id:'receipt-draft',jobId:'job',text:'Fictional draft',version:1}];reloaded.applications[0].draftId='receipt-draft';
 const refreshed=reduceAction(reloaded,{type:'refresh_application_materials',applicationId:'application'},'interface',at).state;
 assert.equal(refreshed.applications[0].answerSave,undefined);assert.equal(applicationAnswerSave(refreshed.applications[0]),null);
});
test('older acknowledged saves display without rewriting records; invalid receipts or absent answers do not',()=>{
 const legacy=fixture({confirmedAnswers:[{question:'Preferred shift?',value:'Night'}],result:{at,message:'Your answers are saved. This employer requires verification.'}}),before=structuredClone(legacy);
 assert.deepEqual(applicationAnswerSave(legacy),{at,count:null});assert.deepEqual(legacy,before);
 for(const receipt of [{at:'bad',count:1},{at,count:0},{at,count:201},{at,count:1.5}])assert.equal(applicationAnswerSave(fixture({confirmedAnswers:legacy.confirmedAnswers,answerSave:receipt})),null);
 assert.equal(applicationAnswerSave(fixture({answerSave:{at,count:1}})),null);
});
test('queued/running questions are progress, not another editable approval form',()=>{
 for(const status of ['queued','processing'])assert.equal(applicationAnswerStage(fixture({status,report:{unresolved:[{question:'Are you a human?',source:'verification'}]}})),'in_progress');
 for(const status of ['uncertain','applied','failed'])assert.equal(applicationAnswerStage(fixture({status})),'reference');
 assert.equal(applicationAnswerStage(fixture()),'editable');
});
test('verification is detected from its report source or captured choices, without treating normal dropdowns as verification',()=>{
 const app=fixture({report:{unresolved:[{question:'Which describes you?*'}],questions:[{question:'Which describes you?',field_type:'combobox',options:['I am a human','I am an AI, bot, or automated program']}]}});
 assert.equal(applicationAnswerStage(app),'verification');assert.deepEqual(applicationVerificationQuestions(app),['Which describes you?*']);
 assert.equal(applicationAnswerStage(fixture({report:{unresolved:[{question:'Preferred shift?'}],questions:[{question:'Preferred shift?',field_type:'select',options:['Day','Night']}]}})),'editable');
});
test('saving ordinary answers with a known verification block retains answers but does not queue another futile run',()=>{
 const s=emptyState();s.applications=[fixture({report:{unresolved:[{question:'Which describes you?',source:'verification'}],questions:[{question:'Preferred shift?',field_type:'select',options:['Day','Night']},{question:'Which describes you?',field_type:'combobox',options:['I am a human','I am an AI, bot, or automated program']}]}})];
 const saved=reduceAction(s,{type:'answer_application_questions',applicationId:'application',answers:[{question:'Preferred shift?',value:'Night'}],confirmation:'CONFIRMED',continueAgent:true},'interface',at);
 assert.equal(saved.state.applications[0].status,'needs_attention');assert.equal(saved.state.applications[0].agentAuthorizedAt,undefined);
 assert.equal(saved.state.applications[0].confirmedAnswers[0].value,'Night');assert.equal(saved.state.accountProfile.employerQuestions.find(q=>q.question==='Preferred shift?').answer,'Night');
 assert.match(saved.message,/verification/);assert.match(saved.message,/not restarted/);
 const again=reduceAction(saved.state,{type:'answer_application_questions',applicationId:'application',answers:[{question:'Preferred shift?',value:'Day'}],confirmation:'CONFIRMED',continueAgent:true},'interface',at);
 assert.equal(again.state.applications[0].status,'needs_attention');assert.equal(again.state.applications.length,1);assert.equal(again.state.applications[0].confirmedAnswers[0].value,'Day');
});
function emptyState(){const s=baseState();s.accountProfile={fullName:'Fictional applicant',headline:'Analyst',targetRole:'SOC Analyst',completedAt:at};s.jobs=[{id:'job',title:'Fixture analyst',company:'Fictional test company',sample:false,disposition:'apply_requested',url:'https://employer.example/job',description:'Isolated fixture',skills:[]}];return s;}
const fixture=(extra={})=>({id:'application',jobId:'job',at,status:'needs_attention',report:{unresolved:[{question:'Why this role?',field_type:'textarea'}],questions:[{question:'Preferred shift?',field_type:'combobox',options:['Day','Night']},{question:'Work arrangement',field_type:'select',options:['Office','Remote']}]},...extra});
test('answered and optional dropdowns join unresolved prose without inventing answers or mutating records',()=>{const app=fixture(),before=structuredClone(app),rows=applicationFormQuestions(app);assert.deepEqual(rows.map(q=>q.question),['Why this role?','Preferred shift?','Work arrangement']);assert.deepEqual(app,before);assert.ok(rows.every(q=>q.value===undefined));});
test('normalized duplicates retain the original unresolved reason and profile authority',()=>{const app=fixture({report:{unresolved:[{question:'Country*',field_type:'text',source:'edit_profile',reason:'Update profile'}],questions:[{question:'Country',field_type:'combobox',options:['Offered']} ]}});const rows=applicationFormQuestions(app);assert.equal(rows.length,1);assert.equal(rows[0].source,'edit_profile');assert.equal(rows[0].reason,'Update profile');});
test('only current-run/exact-vacancy memory restores abbreviated dropdown catalogs',()=>{const app=fixture(),bank=[{question:'Recovered menu',fieldType:'combobox',jobId:'job',originRequestId:'application',options:['A']},{question:'Wrong employer',fieldType:'combobox',jobId:'other',originRequestId:'application',options:['B']},{question:'Old menu',fieldType:'combobox',jobId:'job',optionsCheckedAt:'2025-01-01T00:00:00Z',options:['C']},{question:'Fresh menu',fieldType:'select',optionsJobId:'job',optionsCheckedAt:'2026-11-07T12:00:01Z',options:['D']}];const labels=applicationFormQuestions(app,bank).map(q=>q.question);assert.ok(labels.includes('Recovered menu')&&labels.includes('Fresh menu'));assert.ok(!labels.includes('Wrong employer')&&!labels.includes('Old menu'));});
test('more than forty dropdowns remain visible, while secrets/helpers and unbounded catalogs are excluded',()=>{const app=fixture({report:{questions:[...Array.from({length:230},(_,i)=>({question:`Menu ${i}`,field_type:'combobox',options:['Offered']})),{question:'Password',field_type:'password'},{question:'Unlabelled field',field_type:'combobox'}]}});assert.equal(applicationFormQuestions(app).length,200);const small=fixture({report:{questions:[{question:'Password',field_type:'combobox'},{question:'CAPTCHA',field_type:'combobox'},{question:'Unlabelled field',field_type:'combobox'},{question:'Resume',field_type:'file'}]}});assert.equal(applicationFormQuestions(small).length,0);});
test('recorded menu answers can be approved without queuing, while non-offered or foreign questions fail',()=>{const s=emptyState();s.applications=[fixture()];const act=answers=>actionSchema.parse({type:'answer_application_questions',applicationId:'application',answers,confirmation:'CONFIRMED'});const saved=reduceAction(s,act([{question:'Preferred shift?',value:'Night'}]),'interface',at).state;assert.equal(saved.applications[0].status,'needs_action');assert.deepEqual(saved.applications[0].confirmedAnswers,[{question:'Preferred shift?',value:'Night'}]);assert.equal(saved.applications[0].agentAuthorizedAt,undefined);assert.throws(()=>reduceAction(s,act([{question:'Preferred shift?',value:'Invented option'}]),'interface',at),/captured/);assert.throws(()=>reduceAction(s,act([{question:'Other employer question',value:'Yes'}]),'interface',at),/recorded/);});
test('processing, queued, confirmed and uncertain records remain reference-only, including possible prior delivery',()=>{for(const status of ['processing','queued','applied','uncertain','failed']){const a=fixture({status}),s=emptyState();s.applications=[a];assert.equal(canEditApplicationQuestions(a),false);assert.throws(()=>reduceAction(s,{type:'answer_application_questions',applicationId:'application',answers:[{question:'Preferred shift?',value:'Night'}],confirmation:'CONFIRMED'},'interface',at),/known unsent/);}const a=fixture({report:{journey:{possible_delivery:true}}});assert.equal(canEditApplicationQuestions(a),false);});
test('an unknown dropdown cannot accept a made-up option, and 60 confirmed menus survive together',()=>{const s=emptyState();s.applications=[fixture({report:{questions:[{question:'Unknown menu',field_type:'combobox',options:[]}]}})];assert.throws(()=>reduceAction(s,{type:'answer_application_questions',applicationId:'application',answers:[{question:'Unknown menu',value:'Guess'}],confirmation:'CONFIRMED'},'interface',at),/captured/);const questions=Array.from({length:60},(_,i)=>({question:`Menu ${i}`,field_type:'select',options:['Choice']}));s.applications=[fixture({report:{questions}})];const action=actionSchema.parse({type:'answer_application_questions',applicationId:'application',answers:questions.map(q=>({question:q.question,value:'Choice'})),confirmation:'CONFIRMED'});assert.equal(reduceAction(s,action,'interface',at).state.applications[0].confirmedAnswers.length,60);});

const saveAnswers=(state,answers,time=at)=>reduceAction(state,actionSchema.parse({type:'answer_application_questions',applicationId:'application',answers,confirmation:'CONFIRMED'}),'interface',time);
test('one approval saves text and captured dropdowns to the library without queuing or changing original state',()=>{
 const s=emptyState();s.applications=[fixture()];const before=structuredClone(s),answers=[{question:'Why this role?',value:'My reviewed CV-based answer.'},{question:'Preferred shift?',value:'Night'}];
 const result=saveAnswers(s,answers),bank=result.state.accountProfile.employerQuestions;
 assert.deepEqual(s,before);assert.equal(bank.length,2);assert.deepEqual(result.state.applications[0].confirmedAnswers,answers);assert.equal(result.state.applications[0].status,'needs_action');assert.equal(result.state.applications[0].agentAuthorizedAt,undefined);assert.match(result.message,/Answers library/);
 for(const answer of answers){const q=bank.find(q=>q.question===answer.question);assert.equal(q.answer,answer.value);assert.equal(q.source,'user');assert.equal(q.reusePolicy,'exact_question');assert.equal(q.jobSpecific,false);}
 assert.deepEqual(bank.find(q=>q.question==='Preferred shift?').options,['Day','Night']);assert.equal(bank[0].optionsJobId,'job');
});
test('a revised answer updates the existing library entry and preserves unrelated questions and draft provenance',()=>{
 let s=emptyState();s.applications=[fixture()];s=saveAnswers(s,[{question:'Why this role?',value:'Earlier answer'},{question:'Preferred shift?',value:'Day'}]).state;
 const id=s.accountProfile.employerQuestions.find(q=>q.question==='Why this role?').id;s.accountProfile.employerQuestions.find(q=>q.id===id).aiDraft=true;
 s=saveAnswers(s,[{question:'Why this role?',value:'Updated reviewed answer'}],'2026-11-07T12:01:00Z').state;
 assert.equal(s.accountProfile.employerQuestions.length,2);const row=s.accountProfile.employerQuestions.find(q=>q.id===id);assert.equal(row.answer,'Updated reviewed answer');assert.equal(row.aiDraft,true);assert.equal(row.updatedAt,'2026-11-07T12:01:00Z');assert.equal(s.accountProfile.employerQuestions.find(q=>q.question==='Preferred shift?').answer,'Day');
});
test('current dropdown metadata wins over a text helper when saving the reusable answer',()=>{
 const s=emptyState();s.applications=[fixture({report:{unresolved:[{question:'Preferred shift?',field_type:'text'}],questions:[{question:'Preferred shift?',field_type:'combobox',options:['Day','Night']}]}})];
 const result=saveAnswers(s,[{question:'Preferred shift?',value:'Night'}]);assert.equal(result.state.accountProfile.employerQuestions[0].fieldType,'combobox');assert.deepEqual(result.state.accountProfile.employerQuestions[0].options,['Day','Night']);
});
test('older generated reports retain draft origin even when the question has not reached the library',()=>{
 const s=emptyState();s.applications=[fixture({report:{unresolved:[{question:'Why this role?',field_type:'textarea',source:'generated',suggested_value:'Generated fixture draft.'}]}})];
 const result=saveAnswers(s,[{question:'Why this role?',value:'Generated fixture draft.'}]);assert.equal(result.state.accountProfile.employerQuestions[0].aiDraft,true);assert.equal(result.state.accountProfile.employerQuestions[0].source,'user');
});
test('consent and human-verification responses are references rather than reusable authorization',()=>{
 for(const question of ['I agree to the employer privacy terms','Which best describes you?']){
  const s=emptyState(),options=question.startsWith('I agree')?['Yes','No']:['I am a human.','I am an AI, bot, or automated program.'];s.applications=[fixture({report:{questions:[{question,field_type:'select',options}]}})];
  const result=saveAnswers(s,[{question,value:options[0]}]);assert.equal(result.state.accountProfile.employerQuestions[0].reusePolicy,'manual_only');assert.equal(result.state.applications[0].status,'needs_action');assert.equal(result.state.applications[0].result,undefined);
 }
});
test('long reviewed answers are retained without truncation and remain editable in the library',()=>{
 const s=emptyState();s.applications=[fixture()];const answer='Reviewed evidence. '.repeat(200),saved=saveAnswers(s,[{question:'Why this role?',value:answer.trim()}]).state,row=saved.accountProfile.employerQuestions[0];assert.ok(answer.length>2000);assert.equal(row.answer,answer.trim());
 const edited=reduceAction(saved,actionSchema.parse({type:'save_employer_answer',questionId:row.id,answer:answer+' Updated.'}),'interface',at).state;assert.equal(edited.accountProfile.employerQuestions[0].answer,(answer+' Updated.').trim());
});
test('failed validation or library quota cannot partially save answers or silently drop library entries',()=>{
 const s=emptyState();s.applications=[fixture()];const before=structuredClone(s);assert.throws(()=>saveAnswers(s,[{question:'Why this role?',value:'Valid text'},{question:'Preferred shift?',value:'Unavailable'}]),/captured/);assert.deepEqual(s,before);
 s.profile.resumeText='x'.repeat(1650000);const full=structuredClone(s);assert.throws(()=>saveAnswers(s,[{question:'Why this role?',value:'Reviewed'}]),/size limit/);assert.deepEqual(s,full);
 delete s.accountProfile;assert.throws(()=>saveAnswers(s,[{question:'Why this role?',value:'Reviewed'}]),/Account Profile/);
});
