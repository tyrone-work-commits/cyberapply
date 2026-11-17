import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const dir='.sites-runtime/application-answer-prefill-tests';await mkdir(dir,{recursive:true});
for(const name of ['verification-question','application-answer-prefill','application-form-questions','application-question-choices','employer-questions','employer-location-choices','candidate-facts','expected-salary'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const component=ts.transpileModule((await readFile('app/application-question-answers.tsx','utf8')).replace("import './application-question-attention.css';",''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from ['"]@\/lib\/([^'"]+)['"]/g,"from './$1.mjs'");await writeFile(`${dir}/application-question-answers.mjs`,component.replace(/from '(\.\/[^']+)'/g,(_,name)=>"from '"+name+(name.endsWith('.mjs')?'':'.mjs')+"'"));
const child=ts.transpileModule(await readFile('app/application-verification-handoff.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;await writeFile(`${dir}/application-verification-handoff.mjs`,child);
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
 assert.equal(prefill(app(),entry('First name'),{isDropdown:false,options:[]},[],p).value,'Fictional');
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

test('name parts use current profile first/middle/last with generic Name kept whole',()=>{
 const p={fullName:'Tyrone Osadebame Ekhator'};
 for(const [question,value] of [['First name','Tyrone'],['Last name','Ekhator'],['Middle name','Osadebame'],['Full name',p.fullName],['Name',p.fullName]])assert.equal(prefill(app(),entry(question,{field_type:'text'}),{isDropdown:false,options:[]},[],p).value,value);
});


test('actual checkbox controls mirror confirmed true/false and retain independent labelled options',()=>{
 const questions=[{question:'I acknowledge the statement',field_type:'checkbox',checkboxLabel:'Acknowledged'},{question:'Contact channels — SMS',field_type:'checkbox',checkboxLabel:'SMS'}];
 const request=app({report:{questions},confirmedAnswers:[{question:questions[0].question,value:'true'},{question:questions[1].question,value:'false'}]});
 const html=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:request,employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
 assert.match(html,/<input id="application-answer-fixture-0" type="checkbox" checked=""\/>/);assert.match(html,/<span>Acknowledged<\/span>/);
 assert.match(html,/<input id="application-answer-fixture-1" type="checkbox"\/>/);assert.doesNotMatch(html,/<textarea|<select/);
 const readOnly=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:{...request,status:'uncertain'},employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
 assert.match(readOnly,/<input id="application-answer-fixture-0" type="checkbox" disabled="" checked=""\/>/);
});

test('checkbox consent from another application is not preselected; explicit answers normalize booleans',()=>{
 const field={question:'I acknowledge the statement',field_type:'checkbox'},control={isDropdown:false,isCheckbox:true,options:[]};
 assert.equal(prefill(app(),field,control,[memory({question:field.question,fieldType:'checkbox',answer:'Yes',reusePolicy:'manual_only'})]).value,'');
 for(const [answer,expected] of [['true','Yes'],['false','No'],['Yes','Yes'],['No','No']])assert.equal(prefill(app({confirmedAnswers:[{question:field.question,value:answer}]}),field,control).value,expected);
});


test('other multi-select controls retain every employer option and previously saved selections',()=>{
 const q='Preferred travel schedules?',options=['No Travel','0-25%','25-50%','50%+'];const request=app({report:{questions:[{question:q,field_type:'combobox',multiple:true,options}]},confirmedAnswers:[{question:q,value:'["0-25%","25-50%"]'}]});
 const html=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:request,employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
 assert.match(html,/<select[^>]*multiple=""/);for(const option of options)assert.ok(html.includes('>'+option+'</option>'));assert.match(html,/<option value="0-25%" selected="">/);assert.match(html,/<option value="25-50%" selected="">/);assert.doesNotMatch(html,/<textarea/);
 assert.equal(prefill(app(),{question:q,field_type:'combobox'},{isDropdown:true,multiple:true,options},[memory({question:q,answer:'["0-25%","25-50%"]',multiple:true})]).value,'["0-25%","25-50%"]');
});


test('travel preference uses a collapsed pick-one menu while retaining the employer array format',()=>{
 const q='Are you open to travel if required?*',options=['No Travel','0-25%','25-50%','50%+'];
 for(const [answer,selection] of [['',''],['["0-25%"]','0-25%'],['["0-25%","25-50%"]','']]){
  const request=app({report:{questions:[{question:q,field_type:'combobox',multiple:true,options}]},confirmedAnswers:answer?[{question:q,value:answer}]:[]});
  const before=structuredClone(request),html=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:request,employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
  assert.doesNotMatch(html,/<select[^>]*(?:multiple|size)=/);assert.doesNotMatch(html,/hold Ctrl/);
  for(const option of options)assert.ok(html.includes('>'+option+'</option>'));
  if(selection)assert.match(html,/<option value="0-25%" selected="">/);
  if(answer.includes('25-50%'))assert.match(html,/2 saved selections — choose one to replace/);
  assert.deepEqual(request,before);
 }
});


test('only unresolved/required blanks, invalid choices, drafts and verification are highlighted',()=>{
 const unresolved=[{question:'Your motivation*',field_type:'textarea'},{question:'Work remotely?*',field_type:'combobox'},{question:'Missing menu*',field_type:'combobox'},{question:'Preferred shift*',field_type:'combobox'},{question:'Draft explanation*',field_type:'textarea',source:'generated',suggested_value:'A CV-based draft'},{question:'Which of the following best describes you?',field_type:'combobox',source:'verification'}];
 const request=app({report:{unresolved,questions:[{question:'Work remotely?*',field_type:'combobox',options:['Yes','No']},{question:'Preferred shift*',field_type:'combobox',options:['Day','Night']},{question:'Optional preference',field_type:'combobox',options:['A','B']},{question:'Which of the following best describes you?',field_type:'combobox',options:['I am a human.','I am an AI agent.']}]},confirmedAnswers:[{question:'Work remotely?*',value:'No'},{question:'Preferred shift*',value:'Old shift'}]});
 const html=renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{application:request,employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''}));
 assert.match(html,/5 questions need.*attention/);assert.equal((html.match(/data-attention="input"/g)||[]).length,1);assert.equal((html.match(/data-attention="choices"/g)||[]).length,1);assert.equal((html.match(/data-attention="invalid"/g)||[]).length,1);assert.equal((html.match(/data-attention="review"/g)||[]).length,1);assert.equal((html.match(/data-attention="verification"/g)||[]).length,1);
 assert.match(html,/<textarea[^>]*aria-describedby="application-answer-fixture-0-attention"/);assert.match(html,/<select[^>]*aria-invalid="true"/);
 assert.match(html,/<option value="No" selected="">/);assert.match(html,/>Needs your input</);assert.match(html,/>Employer choices unavailable</);
});

test('saved No/cleared optional selections and completed answers do not keep false attention highlights',()=>{
 const unresolved=[{question:'Explanation*',field_type:'textarea'},{question:'Travel schedules',field_type:'combobox'},{question:'I acknowledge this statement*',field_type:'checkbox'}];
 const request=app({report:{unresolved,questions:[{question:'Travel schedules',field_type:'combobox',multiple:true,options:['A','B']}]},confirmedAnswers:[{question:'Explanation*',value:'My accurate answer'},{question:'Travel schedules',value:'[]'},{question:'I acknowledge this statement*',value:'No'}]});
 const props={application:request,employerQuestions:[],busy:false,onSave:async()=>true,onRefreshChoices:async()=>''};
 assert.doesNotMatch(renderToStaticMarkup(createElement(ApplicationQuestionAnswers,props)),/data-attention=|questions need your attention/);
 for(const status of ['applied','uncertain'])assert.doesNotMatch(renderToStaticMarkup(createElement(ApplicationQuestionAnswers,{...props,application:{...request,status,confirmedAnswers:[]}})),/data-attention=|questions need your attention/);
});
