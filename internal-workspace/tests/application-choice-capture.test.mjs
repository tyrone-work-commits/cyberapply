import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dir='.sites-runtime/location-choice-tests';await mkdir(dir,{recursive:true});
for(const name of ['employer-location-choices','application-choice-capture','features','candidate-facts','cover-letter','cyber-domain','employer-questions','application-agent-state','application-deletion','job-catalog','job-discovery','job-extraction','scan-taxonomy','provider-jobs','employer-question-options','application-question-choices'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {queueLocationCapture,claimLocationCapture,completeLocationCapture}=await import('../'+dir+'/application-choice-capture.mjs');
const {emptyState}=await import('../'+dir+'/cyber-domain.mjs');const {applicationQuestionChoices}=await import('../'+dir+'/application-question-choices.mjs');
const at='2026-11-06T21:00:00Z';
function fixture(status='needs_attention'){
 const s=emptyState();s.newApplicationAgent={enabled:true,expiresAt:'2026-12-01T00:00:00Z'};
 s.accountProfile={fullName:'Fixture',headline:'',targetRole:'',completedAt:at,employerQuestions:[{id:'country',question:'Country*',fieldType:'combobox',answer:'Saved answer',source:'user',status:'answered',evidence:'',jobId:'job',options:[],updatedAt:at,jobSpecific:false}]};
 s.jobs=[{id:'job',company:'Fixture',source:{provider:'greenhouse',board:'fixture',externalId:'123',region:'global'},url:'https://job-boards.greenhouse.io/fixture/jobs/123'}];
 s.applications=[{id:'app',jobId:'job',status,cv:{fileId:'chosen'},candidate:{resumeText:'Private CV'},confirmedAnswers:[{question:'Country*',value:'Saved answer'}],claim:{id:'original'},result:{at,message:'Original outcome'},report:{journey:{possible_delivery:true},questions:[{question:'Country*',field_type:'combobox',options:[]},{question:'Location (City)*',field_type:'combobox',options:[]}]} }];return s;
}
test('read-only leases preserve uncertain/applied/paused applications and expose no CV/profile/answers to the reader',()=>{
 for(const status of ['needs_attention','uncertain','applied']){const s=fixture(status),a=s.applications[0],before=structuredClone(a);queueLocationCapture(s,'app','Dallas',at);const task=claimLocationCapture(s,at);
 assert.deepEqual(Object.keys(task).sort(),['applicationId','captureId','cityQuery','expiresAt','job']);assert.equal(task.cityQuery,'Dallas');
 for(const key of ['status','cv','candidate','confirmedAnswers','claim','result'])assert.deepEqual(a[key],before[key]);assert.deepEqual(a.report.journey,before.report.journey);assert.equal(s.applicationUsage,undefined);
 const countries=Array.from({length:250},(_,i)=>`Offered country ${i} +${i+1}`);
 completeLocationCapture(s,'app',task.captureId,[{question:'Country',field_type:'combobox',options:countries},{question:'Location (City)*',field_type:'combobox',options:['Dallas, Texas, United States'],lookupQuery:'Dallas'}],'',at);
 for(const key of ['status','cv','candidate','confirmedAnswers','claim','result'])assert.deepEqual(a[key],before[key]);assert.deepEqual(a.report.journey,before.report.journey);
 assert.equal(a.report.locationCapture.state,'ready');assert.equal(a.report.questions[0].options.length,250);assert.equal(s.accountProfile.employerQuestions.find(q=>q.id==='country').answer,'Saved answer');assert.equal(s.accountProfile.employerQuestions.find(q=>q.id==='country').options.length,250);
 assert.equal(applicationQuestionChoices(a,{question:'Country*',field_type:'combobox'},[]).options.length,250);
 }
});
test('foreign/deleted requests, wrong leases, duplicates and active application runs cannot be changed',()=>{
 const s=fixture();assert.throws(()=>queueLocationCapture(s,'other','',at),/no longer available/);queueLocationCapture(s,'app','Dallas',at);const task=claimLocationCapture(s,at),before=structuredClone(s);
 assert.throws(()=>queueLocationCapture(s,'app','Dallas',at),/already waiting/);assert.throws(()=>completeLocationCapture(s,'app','wrong',[],'',at),/no longer active/);assert.deepEqual(s,before);
 s.applications[0].status='processing';assert.throws(()=>completeLocationCapture(s,'app',task.captureId,[],'',at),/active application/);
 for(const status of ['queued','processing'])assert.throws(()=>queueLocationCapture(fixture(status),'app','Dallas',at),/active application/);
});
test('expired leases fail without restarting an application or accepting late results',()=>{
 const s=fixture();queueLocationCapture(s,'app','',at);const task=claimLocationCapture(s,at);assert.equal(claimLocationCapture(s,'2026-11-06T21:03:00Z'),null);assert.equal(s.applications[0].report.locationCapture.state,'failed');assert.equal(s.applications[0].status,'needs_attention');
 assert.throws(()=>completeLocationCapture(s,'app',task.captureId,[],'','2026-11-06T21:03:00Z'),/no longer active/);
});
test('a reader waits for an application already working and other readers cannot claim its lease',()=>{
 const s=fixture();queueLocationCapture(s,'app','Dallas',at);s.applications.push({id:'working',status:'processing'});assert.equal(claimLocationCapture(s,at),null);assert.equal(s.applications[0].report.locationCapture.state,'queued');
 s.applications.pop();const task=claimLocationCapture(s,at);assert.ok(task);assert.equal(claimLocationCapture(s,at),null);assert.equal(s.applications[0].report.locationCapture.id,task.captureId);
});
test('only recorded location menus are merged, and unsupported queries/connections/sources fail closed',()=>{
 for(const query of ['https://evil.test','line\nbreak','@secret'])assert.throws(()=>queueLocationCapture(fixture(),'app',query,at),/city name/);
 const s=fixture();queueLocationCapture(s,'app','',at);const task=claimLocationCapture(s,at);completeLocationCapture(s,'app',task.captureId,[{question:'Salary',field_type:'combobox',options:['Invented']},{question:'Country',field_type:'combobox',options:['Offered']}],'',at);assert.equal(s.applications[0].report.questions.length,2);assert.equal(s.applications[0].report.questions[0].options[0],'Offered');
 const disconnected=fixture();delete disconnected.newApplicationAgent;assert.throws(()=>queueLocationCapture(disconnected,'app','',at),/Reconnect/);
 const other=fixture();other.jobs[0].source.provider='lever';assert.throws(()=>queueLocationCapture(other,'app','',at),/Greenhouse/);
});
