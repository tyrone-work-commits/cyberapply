import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dir='.sites-runtime/option-tests';await mkdir(dir,{recursive:true});
for(const name of ['features','candidate-facts','cover-letter','cyber-domain','employer-questions','application-agent-state','application-deletion','job-catalog','job-discovery','employer-question-options'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {fetchEmployerQuestions,mergeEmployerQuestionChoices}=await import('../'+dir+'/employer-question-options.mjs');const {emptyState}=await import('../'+dir+'/cyber-domain.mjs');
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
