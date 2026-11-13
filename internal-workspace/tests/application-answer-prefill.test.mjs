import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const dir='.sites-runtime/application-answer-prefill-tests';await mkdir(dir,{recursive:true});
for(const name of ['application-answer-prefill','application-form-questions','application-question-choices','employer-questions','employer-location-choices','candidate-facts','expected-salary'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const component=ts.transpileModule(await readFile('app/application-question-answers.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ['"]@\/lib\/([^'"]+)['"]/g,"from './$1.mjs'");await writeFile(`${dir}/application-question-answers.mjs`,component);
const {applicationAnswerPrefill:prefill,offeredAnswer}=await import('../'+dir+'/application-answer-prefill.mjs');
const {ApplicationQuestionAnswers}=await import('../'+dir+'/application-question-answers.mjs');
const cv='Fictional Tester\nfictional@example.test\nLinkedIn: https://www.linkedin.com/in/fictional-tester\nEXPERIENCE\nConfigured Docker containers and used GitHub for version control.';
const app=(extra={})=>({id:'fixture',jobId:'job',status:'needs_attention',at:'2026-11-13T12:00:00Z',sourceUrl:'https://employer.example/job',cvSha256:'chosen-cv',candidate:{resumeText:cv},report:{},...extra});
const entry=(question,extra={})=>({question,field_type:'select',...extra});
const choices=options=>({isDropdown:true,options});
const memory=(extra={})=>({id:'answer',question:'Preferred shift?',fieldType:'select',answer:'Night',status:'answered',source:'user',options:['Day','Night'],updatedAt:'2026-11-13T12:00:00Z',jobId:'other',jobSpecific:false,reusePolicy:'exact_question',...extra});

test('recorded dropdown answers appear selected; last inspection wins and No is retained',()=>{
 const request=app({report:{answers:[{question:'Preferred shift?',value:'Day'},{question:'Preferred shift?*',value:'Night'}]}});
 assert.deepEqual(prefill(request,entry('Preferred shift?'),choices(['Day','Night'])),{value:'Night',source:'recorded'});
 assert.equal(prefill(app({report:{answers:[{question:'Previously employed?',value:'No'}]}}),entry('Previously employed?'),choices(['Yes','No'])).value,'No');
});
test('explicit answer for this application takes priority over recorded, library and profile',()=>{
 const request=app({confirmedAnswers:[{question:'Country',value:'Canada'}],report:{answers:[{question:'Country',value:'United States'}]}});
 assert.deepEqual(prefill(request,entry('Country'),choices(['United States','Canada']),[],{country:'United States'}),{value:'Canada',source:'confirmed'});
});
test('reusable matching library answers map to exact current choices, preserving false/no answers',()=>{
 assert.deepEqual(prefill(app(),entry('Preferred shift?*'),choices(['DAY','NIGHT']),[memory()]),{value:'NIGHT',source:'library'});
 assert.equal(prefill(app(),entry('Previously employed?'),choices(['Yes','No']),[memory({question:'Previously employed?',answer:'No'})]).value,'No');
 assert.equal(prefill(app(),entry('Preferred shift?'),choices(['Evening']),[memory()]).value,'');
});
test('job-scoped, stale CV and manual-only library entries are not reused automatically',()=>{
 for(const extra of [{jobSpecific:true,reusePolicy:'job_only'},{source:'cv',cvSha256:'different-cv'},{reusePolicy:'manual_only'},{fieldType:'textarea'}])assert.equal(prefill(app(),entry('Preferred shift?'),choices(['Day','Night']),[memory(extra)]).value,'');
 assert.equal(prefill(app(),entry('Preferred shift?'),choices(['Day','Night']),[memory({source:'cv',cvSha256:'chosen-cv'})]).value,'Night');
});
test('current Account Profile supplies personal fields and offered country/city labels',()=>{
 const p={fullName:'Fictional Tester',city:'Dallas',state:'Texas',country:'USA',phone:'+2348012345678'};
 assert.deepEqual(prefill(app(),entry('Country'),choices(['United States of America','Canada']),[],p),{value:'United States of America',source:'profile'});
 assert.equal(prefill(app(),entry('Location (City)'),choices(['Dallas, Texas, United States','Dallas, Oregon, United States']),[],p).value,'Dallas, Texas, United States');
 assert.equal(prefill(app(),entry('First name'),{isDropdown:false,options:[]},[],p).value,p.fullName);
 assert.equal(prefill(app(),entry('State'),choices(['Texas','Oregon']),[],p).value,'Texas');
 assert.equal(prefill(app(),entry('Country',{phoneCountry:true}),choices(['Nigeria (+234)','United Kingdom (+44)']),[],p).value,'Nigeria (+234)');
});
test('profile work authorization is separate from residence and unknown facts stay blank',()=>{
 const p={country:'USA',ukRightToWork:false,irelandRightToWork:true,usaVisaRequired:false};
 assert.equal(prefill(app(),entry('Are you authorized to work in the United Kingdom or Ireland for any employer?'),choices(['Yes','No']),[],p).value,'Yes');
 assert.equal(prefill(app(),entry('Are you located in the UK or Ireland?'),choices(['Yes','No']),[],p).value,'No');
 assert.equal(prefill(app(),entry('Do you require US visa sponsorship?'),choices(['Yes','No']),[],p).value,'No');
 assert.equal(prefill(app(),entry('Are you authorized to work in Canada?'),choices(['Yes','No']),[],p).value,'');
 assert.equal(prefill(app(),entry('Country'),choices(['Canada']),[memory({question:'Country',answer:'Canada'})],{country:''}).value,'');
});
test('expected salary is derived only from saved USD expectation and annual/monthly units',()=>{
 const p={expectedSalary:{amount:5000,currency:'USD',period:'month'}};
 assert.equal(prefill(app(),entry('Expected annual salary in USD',{field_type:'text'}),{isDropdown:false,options:[]},[],p).value,'USD 60000 per year');
 for(const q of ['Current salary','Expected salary in GBP','Expected hourly salary'])assert.equal(prefill(app(),entry(q),{isDropdown:false,options:[]},[],p).value,'');
});
test('the chosen application CV supplies an explicit professional link, not another CV or invented experience',()=>{
 assert.deepEqual(prefill(app({report:{answers:[{question:'Have you used Docker?',value:'Yes',source:'cv'}]}}),entry('Have you used Docker?'),choices(['Yes','No'])),{value:'Yes',source:'cv'});
 assert.deepEqual(prefill(app(),entry('LinkedIn profile',{field_type:'text'}),{isDropdown:false,options:[]}),{value:'https://www.linkedin.com/in/fictional-tester',source:'cv'});
 assert.equal(prefill(app(),entry('LinkedIn profile',{field_type:'text'}),{isDropdown:false,options:[]},[memory({question:'LinkedIn profile',fieldType:'text',answer:'https://www.linkedin.com/in/older-fixture'})]).value,'https://www.linkedin.com/in/fictional-tester');
 assert.equal(prefill(app(),entry('Do you have five years of Kubernetes experience?'),choices(['Yes','No'])).value,'');
});
test('semantic offered-choice matching is unique and does not pick an arbitrary or verification answer',()=>{
 assert.equal(offeredAnswer('yes',choices(['Yes, I do','No']),'Do you have experience?'),'Yes, I do');
 assert.equal(offeredAnswer('Yes',choices(['Yes, one','Yes, two','No']),'Question?'),'');
 const q='Which best describes you?',options=['I am a human.','I am an AI, bot, or automated program.'];
 assert.equal(prefill(app({confirmedAnswers:[{question:q,value:options[0]}]}),entry(q),choices(options),[memory({question:q,answer:options[0]})]).value,'');
 assert.equal(prefill(app(),entry('I agree to store my personal data'),choices(['Yes','No']),[memory({question:'I agree to store my personal data',answer:'Yes'})]).value,'');
});
test('already-delivered reference controls reflect the actual recorded answer, not a changed profile',()=>{
 assert.deepEqual(prefill(app({status:'uncertain',report:{answers:[{question:'Country',value:'Canada'}]}}),entry('Country'),choices(['Canada','USA']),[],{country:'USA'}),{value:'Canada',source:'recorded'});
});
test('actual React controls render the recorded answer selected and keep normal fields editable',()=>{
 const q='Preferred shift?',field=entry(q,{options:['Day','Night']}),request=app({report:{questions:[field],answers:[{question:q,value:'Night'}]}});
 const html=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:request,employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
 assert.match(html,/<option value="Night" selected="">Night<\/option>/);assert.doesNotMatch(html,/<select[^>]*disabled/);assert.match(html,/Preselected.*recorded answer/);
});
test('actual React controls select library/profile answers when no per-application answer exists',()=>{
 const fields=[entry('Preferred shift?',{options:['Day','Night']}),entry('Country',{options:['United States','Canada'],source:'edit_profile'})];
 const html=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:app({report:{unresolved:fields}}),employerQuestions:[memory()],accountProfile:{country:'USA'},busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
 assert.match(html,/<option value="Night" selected="">Night<\/option>/);assert.match(html,/<option value="United States" selected="">United States<\/option>/);assert.doesNotMatch(html,/<select[^>]*disabled/);
});
test('newly captured choices resolve an untouched saved answer without inventing a choice',()=>{
 const request=app(),q=entry('Preferred shift?');
 assert.equal(prefill(request,q,choices([]),[memory()]).value,'');
 assert.equal(prefill(request,q,choices(['Day','Night']),[memory()]).value,'Night');
 assert.equal(prefill(request,q,choices(['Early','Late']),[memory()]).value,'');
});
