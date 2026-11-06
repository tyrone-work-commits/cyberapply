import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dir='.sites-runtime/option-tests';await mkdir(dir,{recursive:true});
for(const name of ['features','candidate-facts','cover-letter','cyber-domain','employer-questions','application-agent-state','application-deletion','job-catalog','job-discovery','job-extraction','scan-taxonomy','provider-jobs','employer-question-options'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {fetchEmployerQuestions,mergeEmployerQuestionChoices,mergeApplicationQuestionChoices}=await import('../'+dir+'/employer-question-options.mjs');const {emptyState}=await import('../'+dir+'/cyber-domain.mjs');
const job={id:'job',company:'Fixture',source:{provider:'greenhouse',board:'fixture',externalId:'123'}};
const data={id:123,questions:[{label:'Which best describes you?',fields:[{type:'multi_value_single_select',values:[{label:'I am an AI, bot, or automated program.'},{label:'I am a human.'}]}]},{label:'Resume',fields:[{type:'input_file'},{type:'textarea'}]}]};
test('refresh uses only the selected fixed public GET endpoint and learns exact choices',async()=>{
 const rows=await fetchEmployerQuestions(job,async(url,init)=>{assert.equal(url,'https://boards-api.greenhouse.io/v1/boards/fixture/jobs/123?questions=true');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.body,undefined);return Response.json(data);});
 assert.equal(rows.length,1);assert.deepEqual(rows[0].options,data.questions[0].fields[0].values.map(v=>v.label));
});
test('unsupported sources and path injection never reach a network request; wrong job and redirects fail',async()=>{
 for(const source of [{...job.source,provider:'lever'},{...job.source,board:'../evil'},{...job.source,externalId:'123/other'}])await assert.rejects(fetchEmployerQuestions({...job,source},()=>{throw Error('must not fetch');}),/supported public question feed/);
 await assert.rejects(fetchEmployerQuestions(job,async()=>Response.json({...data,id:456})),/exact vacancy/);
 await assert.rejects(fetchEmployerQuestions(job,async()=>new Response(null,{status:302,headers:{Location:'https://private.test'}})),/HTTP 302/);
});
test('merging a supported refresh preserves answers, outcomes and selected CV and leaves verification blank',()=>{
 const s=emptyState();s.accountProfile={fullName:'QA',headline:'',targetRole:'Security',completedAt:'now',employerQuestions:[{id:'question',question:'Which best describes you?',fieldType:'combobox',answer:'',source:'missing',evidence:'',status:'needs_details',jobSpecific:false,jobId:'job',options:[],updatedAt:'old'}]};s.jobs=[job];s.selectedCvId='chosen';s.applications=[{id:'request',jobId:'job',status:'needs_attention'}];const before=structuredClone(s.applications);
 mergeEmployerQuestionChoices(s,'question',[{question:'Which best describes you?',field_type:'combobox',options:['I am an AI, bot, or automated program.','I am a human.']}],'2026-11-02T18:00:00Z');
 assert.equal(s.accountProfile.employerQuestions[0].answer,'');assert.equal(s.accountProfile.employerQuestions[0].reusePolicy,'manual_only');assert.equal(s.accountProfile.employerQuestions[0].options.length,2);assert.deepEqual(s.applications,before);assert.equal(s.selectedCvId,'chosen');
 assert.throws(()=>mergeEmployerQuestionChoices(s,'other',[],'now'),/no longer available/);
});

test('public phone fields keep their control type and an empty text duplicate cannot shadow a saved phone answer',async()=>{
 const rows=await fetchEmployerQuestions(job,async()=>Response.json({id:123,questions:[{label:'Phone',fields:[{name:'phone',type:'input_text'}]}]}));assert.equal(rows[0].field_type,'tel');
 const s=emptyState(),base={question:'Phone*',source:'edit_profile',evidence:'Saved phone',status:'answered',jobSpecific:false,jobId:'job',options:[],updatedAt:'old'};
 s.accountProfile={fullName:'QA',headline:'',targetRole:'Security',completedAt:'now',employerQuestions:[{...base,id:'saved',fieldType:'tel',answer:'+12345678901'},{...base,id:'empty',question:'Phone',fieldType:'text',source:'missing',answer:'',status:'needs_details'}]};s.jobs=[job];s.applications=[{id:'request',jobId:'job',status:'needs_attention'}];
 mergeEmployerQuestionChoices(s,'saved',rows,'now');assert.deepEqual(s.accountProfile.employerQuestions.map(q=>q.id),['saved']);assert.equal(s.accountProfile.employerQuestions[0].answer,'+12345678901');
});

test('public question refresh includes location menus and every supported field in a question',async()=>{
 const rows=await fetchEmployerQuestions(job,async()=>Response.json({id:123,questions:[{label:'Preference',fields:[{type:'input_text'},{type:'multi_value_single_select',values:[{label:'Day'},{label:'Night'}]}]}],location_questions:[{label:'Work location',fields:[{type:'multi_value_single_select',values:[{label:'Office'},{label:'Remote'}]}]}]}));
 assert.deepEqual(rows.filter(q=>q.field_type==='combobox').map(q=>q.options),[['Day','Night'],['Office','Remote']]);
});

test('exact-application metadata refresh preserves answers, outcome, claim and other vacancies',()=>{
 const s=emptyState();s.jobs=[job,{...job,id:'other'}];s.selectedCvId='chosen';
 s.accountProfile={fullName:'QA',headline:'',targetRole:'Security',completedAt:'now',employerQuestions:[{id:'answer',question:'Shift?',fieldType:'combobox',answer:'Day',source:'user',evidence:'User',status:'answered',jobSpecific:false,jobId:'job',options:[],updatedAt:'old'}]};
 s.applications=[{id:'request',jobId:'job',status:'needs_attention',confirmedAnswers:[{question:'Shift?',value:'Day'}],result:{at:'2026-11-01',message:'Paused'},claim:{id:'old'},report:{unresolved:[{question:'Shift?'}],questions:[],journey:{possible_delivery:true}}},{id:'other',jobId:'other',status:'needs_attention',report:{questions:[]}}];
 const before=structuredClone(s.applications),rows=[{question:'Shift?',field_type:'combobox',options:[' Day ','Night','Day']}];
 mergeApplicationQuestionChoices(s,'request',rows,'2026-11-06T20:00:00Z');
 assert.deepEqual(s.applications[0].report.questions[0].options,['Day','Night']);
 for(const key of ['status','confirmedAnswers','claim','result'])assert.deepEqual(s.applications[0][key],before[0][key]);
 assert.deepEqual(s.applications[0].report.journey,before[0].report.journey);assert.deepEqual(s.applications[1],before[1]);
 assert.equal(s.accountProfile.employerQuestions.find(q=>q.id==='answer').answer,'Day');assert.equal(s.selectedCvId,'chosen');
});

test('empty feeds never erase existing choices and active claims cannot be refreshed',()=>{
 const s=emptyState();s.jobs=[job];s.applications=[{id:'request',jobId:'job',status:'needs_attention',report:{questions:[{question:'Shift?',field_type:'combobox',options:['Day','Night']}]}}];
 mergeApplicationQuestionChoices(s,'request',[{question:'Shift?',field_type:'combobox',options:[]}],'now');assert.deepEqual(s.applications[0].report.questions[0].options,['Day','Night']);
 s.applications[0].status='processing';const before=structuredClone(s);assert.throws(()=>mergeApplicationQuestionChoices(s,'request',[],'now'),/currently reading/);assert.deepEqual(s,before);
 assert.throws(()=>mergeApplicationQuestionChoices(s,'foreign',[],'now'),/no longer available/);
});

test('repeated choice refresh bounds new catalogue entries without dropping existing questions',()=>{
 const s=emptyState();s.jobs=[job];s.applications=[{id:'request',jobId:'job',status:'needs_attention',report:{questions:Array.from({length:200},(_,i)=>({question:`Existing ${i}`,field_type:'combobox',options:['Keep']}))}}];
 const message=mergeApplicationQuestionChoices(s,'request',[{question:'New menu',field_type:'combobox',options:['New']},{question:'Existing 0',field_type:'combobox',options:['Updated']}],'now');
 assert.equal(s.applications[0].report.questions.length,200);assert.deepEqual(s.applications[0].report.questions[0].options,['Updated']);assert.match(message,/1 additional menus could not fit/);
});
