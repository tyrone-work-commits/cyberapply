import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/experience-answer-tests',done=new Set();
await mkdir(dir,{recursive:true});
async function compile(name){
 if(done.has(name))return;done.add(name);
 let code=ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const deps=[...code.matchAll(/from ['"]\.\/([^'"]+)['"]/g)].map(m=>m[1]);
 code=code.replace(/from ['"]\.\/([^'"]+)['"]/g,"from './$1.mjs'");
 await writeFile(`${dir}/${name}.mjs`,code);
 for(const dep of deps)await compile(dep);
}
for(const name of ['cyber-domain','application-answer-prefill'])await compile(name);
const domain=await import('../'+dir+'/cyber-domain.mjs');
const {applicationAnswerPrefill:prefill}=await import('../'+dir+'/application-answer-prefill.mjs');
const {rememberEmployerQuestions}=await import('../'+dir+'/employer-questions.mjs');
const at='2026-11-27T12:00:00Z',question='Years of cybersecurity experience';
function fixture(){
 const state=domain.emptyState();state.accountProfile={fullName:'Fictional Candidate',headline:'Analyst',targetRole:'SOC Analyst',completedAt:at,yearsExperience:99};
 state.jobs=[{id:'job',title:'SOC Analyst',company:'Fictional Employer',location:'',workMode:'Remote',url:'https://employer.example/job',description:'Investigate security alerts.',skills:[],saved:false,disposition:'open',createdAt:at}];
 state.applications=[{id:'request',jobId:'job',draftId:'draft',draftVersion:1,text:'',candidate:{...state.profile,resumeText:'Experience\nSOC Analyst | Jan 2020 - Dec 2024'},at,status:'needs_attention',reason:'connection_required',sourceUrl:'https://employer.example/job',report:{unresolved:[{question,field_type:'number',required:true}],questions:[{question,field_type:'number',required:true}]}}];
 return state;
}
const choices={isDropdown:false,options:[]};
test('legacy profile duration is removed while other facts and history remain unchanged',()=>{
 const state=fixture(),before=structuredClone(state);
 const cleaned=domain.liveState(state);assert.equal('yearsExperience' in cleaned.accountProfile,false);
 assert.equal(state.accountProfile.yearsExperience,99);assert.deepEqual(cleaned.applications,before.applications);
 assert.equal(domain.actionSchema.safeParse({type:'complete_onboarding',fullName:'Fictional Candidate',headline:'',targetRole:'SOC Analyst',yearsExperience:3}).success,false);
});
test('experience estimates and old profile totals do not prefill an editable employer question',()=>{
 const state=fixture(),app=state.applications[0];
 app.report.answers=[{question,value:'4',source:'cv'}];
 const memory=[{question,fieldType:'number',source:'cv',answer:'4',status:'answered',updatedAt:at,options:[]}];
 assert.equal(prefill(app,{question,field_type:'number'},choices,memory,state.accountProfile).value,'');
 rememberEmployerQuestions(state,app,app.report,at);
 assert.equal(state.accountProfile.employerQuestions[0].answer,'');
});
test('a user answer saves to the application and library and prefills a later matching question',()=>{
 const state=fixture();
 const action=domain.actionSchema.parse({type:'answer_application_questions',applicationId:'request',answers:[{question,value:'3'}],confirmation:'CONFIRMED'});
 const saved=domain.reduceAction(state,action,'interface',at).state;
 const memory=saved.accountProfile.employerQuestions;
 assert.equal(saved.applications[0].confirmedAnswers[0].value,'3');assert.equal(memory[0].answer,'3');assert.equal(memory[0].source,'user');
 const next={...saved.applications[0],id:'next',jobId:'another-job',confirmedAnswers:[],report:{}};
 assert.deepEqual(prefill(next,{question,field_type:'number'},choices,memory,saved.accountProfile),{value:'3',source:'library'});
 assert.equal('yearsExperience' in saved.accountProfile,false);
});
