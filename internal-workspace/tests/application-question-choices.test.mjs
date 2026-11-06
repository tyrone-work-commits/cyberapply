import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const dir='.sites-runtime/application-choice-tests';await mkdir(dir,{recursive:true});
for(const name of ['application-question-choices','employer-questions'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {applicationQuestionChoices}=await import('../'+dir+'/application-question-choices.mjs');
const entry={question:'Which shift?*',field_type:'combobox'},app={jobId:'job',report:{questions:[]},result:{at:'2026-11-02T10:00:00Z'}};
const memory=(extra={})=>({question:'Which shift?',fieldType:'combobox',jobId:'job',options:['Day','Night'],...extra});

test('an original dropdown uses its recorded options, while prose remains a text control',()=>{
 const report={...app,report:{questions:[{question:'Which shift?',field_type:'combobox',options:['Early','Late']}]}};
 assert.deepEqual(applicationQuestionChoices(report,entry,[memory()]).options,['Early','Late']);
 assert.equal(applicationQuestionChoices(app,{question:'Describe your work',field_type:'textarea'},[]).isDropdown,false);
});
test('exact vacancy choices saved in Edit Profile fill a missing older report',()=>{
 const r=applicationQuestionChoices(app,entry,[memory()]);assert.equal(r.isDropdown,true);assert.deepEqual(r.options,['Day','Night']);
});
test('another employer or question cannot supply options to this application',()=>{
 assert.deepEqual(applicationQuestionChoices(app,entry,[memory({optionsJobId:'other'})]).options,[]);
 assert.deepEqual(applicationQuestionChoices(app,entry,[memory({question:'Other question'})]).options,[]);
});
test('fresh same-vacancy profile choices replace outdated report choices',()=>{
 const report={...app,report:{questions:[{question:'Which shift?',field_type:'combobox',options:['Old']}]}},r=applicationQuestionChoices(report,entry,[memory({optionsCheckedAt:'2026-11-02T11:00:00Z'})]);assert.deepEqual(r.options,['Day','Night']);
});
test('missing choices stay empty and no option or human answer is automatically selected',()=>{
 const before=structuredClone(app);assert.deepEqual(applicationQuestionChoices(app,entry,[]),{isDropdown:true,options:[],truncated:false});assert.deepEqual(app,before);
 const human={question:'Which describes you?',field_type:'combobox',options:['I am an AI, bot, or automated program.','I am a human.']};assert.deepEqual(applicationQuestionChoices(app,human).options,human.options);assert.equal(human.value,undefined);
});
test('truncated menus and malformed option entries are represented without executing content',()=>{
 const r=applicationQuestionChoices(app,{...entry,options:[' Day ',null,7,'Night'],optionsTruncated:true});assert.deepEqual(r.options,['Day','Night']);assert.equal(r.truncated,true);
});

test('a technical text fallback uses the actual dropdown captured for that exact question',()=>{
 const report={...app,report:{questions:[{question:'Which shift?',field_type:'combobox',options:['Day','Night']}]}};
 assert.equal(applicationQuestionChoices(report,{...entry,field_type:'text'}).isDropdown,true);
 assert.deepEqual(applicationQuestionChoices(report,{...entry,field_type:'text'}).options,['Day','Night']);
});
