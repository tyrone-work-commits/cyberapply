import {test} from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/application-settings-tests';await mkdir(dir,{recursive:true});for(const name of ['employer-questions','features','candidate-facts','cover-letter','cyber-domain','application-agent-state','application-progress','application-question-choices','application-actions'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));const d=await import('../'+dir+'/cyber-domain.mjs'),a=await import('../'+dir+'/application-agent-state.mjs'),p=await import('../'+dir+'/application-progress.mjs'),actions=await import('../'+dir+'/application-actions.mjs');const at='2026-11-05T10:00:00Z';
function fixture(){const s=d.emptyState();s.profile.resumeText='Fictional Candidate\nEXPERIENCE\nInvestigated Python and SIEM alerts.';s.attachments=[{id:'cv',key:'fixture',name:'fixture.txt',type:'text/plain',size:100,createdAt:at,textExtracted:true}];s.selectedCvId='cv';s.newApplicationAgent={enabled:true,tokenHash:'fixture',issuedAt:at,expiresAt:'2030-01-01'};s.accountProfile={fullName:'Fictional Candidate',headline:'Analyst',targetRole:'SOC Analyst',completedAt:at};s.jobs=[{id:'job',title:'Security Analyst',company:'Fictional Company',location:'',workMode:'Remote',url:'https://employer.example/job',description:'Investigate security alerts and document findings.',skills:['Python','Linux','SIEM'],sample:false,saved:false,disposition:'open',createdAt:at}];return s;}
const apply=s=>d.reduceAction(s,{type:'decide_job',jobId:'job',decision:'apply'},'interface',at).state;
const prefs=(s,changes)=>d.reduceAction(s,{type:'set_apply_settings',mode:'automatic',dailyLimit:20,minimumMatch:0,...changes},'interface',at).state;
test('automatic mode needs prior explicit application authorization',()=>{const s=fixture();delete s.newApplicationAgent;assert.throws(()=>prefs(s,{}),/authorize automatic/);const authorized=prefs(s,{authorizeAutomatic:true});assert.equal(authorized.applicationSettings.autoConsentAt,at);assert.equal(apply(authorized).applications[0].status,'needs_action');});
test('daily limits are consumed at claim and queued work waits for the next UTC day',()=>{let s=prefs(apply(fixture()),{dailyLimit:1});s.jobs.push({...s.jobs[0],id:'second',url:'https://employer.example/second',disposition:'open'});s=d.reduceAction(s,{type:'decide_job',jobId:'second',decision:'apply'},'interface',at).state;const first=a.claimApplication(s,at);a.completeApplication(s,{requestId:first.id,claimId:first.claim.id,status:'needs_attention',message:'Fictional missing detail.'},at);assert.equal(a.claimApplication(s,at),null);assert.equal(s.applications.find(x=>x.status==='queued').reason,'daily_limit');assert.ok(a.claimApplication(s,'2026-11-06T10:00:00Z'));assert.equal(d.applicationRunsToday(s,'2026-11-06T10:00:00Z'),1);});
test('minimum match uses the request CV snapshot and does not invent a score',()=>{let s=apply(prefs(fixture(),{minimumMatch:80}));assert.equal(s.applications[0].reason,'below_minimum_match');s.profile.resumeText+=' Linux';assert.throws(()=>d.reduceAction(s,{type:'queue_application_agent',applicationId:s.applications[0].id},'interface',at),/minimum match/);s=prefs(s,{minimumMatch:50});assert.equal(d.reduceAction(s,{type:'queue_application_agent',applicationId:s.applications[0].id},'interface',at).state.applications[0].status,'queued');assert.equal(d.applicationMatchScore('evidence',{skills:[]}),null);});
test('possible prior delivery remains protected even if an older status says unsent',()=>{const s=apply(fixture()),r=s.applications[0];r.status='needs_attention';r.report={journey:{version:1,possible_delivery:true}};assert.throws(()=>d.reduceAction(s,{type:'queue_application_agent',applicationId:r.id},'interface',at),/may have delivered/);assert.equal(p.applicationProgress(r).canQueue,false);r.status='queued';assert.equal(a.claimApplication(s,at),null);assert.equal(r.status,'uncertain');});
test('Actions removes confirmed ordinary answers but retains direct human verification',()=>{const s=apply(fixture()),r=s.applications[0];r.status='needs_attention';r.report={unresolved:[{question:'Why this role?',field_type:'textarea'},{question:'Which best describes you?',field_type:'select',options:['I am a human','I am an AI']}]};r.confirmedAnswers=[{question:'Why this role?',value:'My reviewed answer.'}];const open=actions.openApplicationQuestions(s);assert.equal(open.length,1);assert.equal(open[0].manual,true);});
test('answering the final ordinary question releases only an explicitly continued unsent request',()=>{let s=apply(fixture()),r=s.applications[0];r.status='needs_attention';r.report={unresolved:[{question:'Why this role?',field_type:'textarea'}]};s=d.reduceAction(s,{type:'answer_application_questions',applicationId:r.id,answers:[{question:'Why this role?',value:'Reviewed factual answer.'}],confirmation:'CONFIRMED'},'interface',at).state;assert.equal(actions.openApplicationQuestions(s).length,0);assert.equal(s.applications[0].status,'needs_action');s=d.reduceAction(s,{type:'queue_application_agent',applicationId:r.id},'interface',at).state;assert.equal(s.applications[0].status,'queued');assert.equal(s.applications[0].confirmedAnswers[0].value,'Reviewed factual answer.');});
test('Actions never treats a possible prior delivery as a question to release',()=>{const s=apply(fixture()),r=s.applications[0];r.status='needs_attention';r.report={journey:{possible_delivery:true},unresolved:[{question:'Question'}]};assert.deepEqual(actions.openApplicationQuestions(s),[]);});

test('Automatic Apply is the only accepted mode and a removed review choice cannot change queues',()=>{
 const s=apply(fixture()),before=structuredClone(s);
 assert.throws(()=>prefs(s,{mode:'review'}));
 assert.equal(d.actionSchema.safeParse({type:'set_apply_settings',mode:'review',dailyLimit:20,minimumMatch:0}).success,false);
 assert.deepEqual(s,before);
 assert.equal(d.getApplySettings(d.emptyState()).mode,'automatic');
 assert.equal(d.getApplySettings(d.emptyState()).autoConsentAt,undefined);
});
test('legacy review settings normalize for new requests without rewriting or restarting older work',()=>{
 const s=apply(fixture()),old=s.applications[0];old.status='needs_action';old.reason='review_required';delete old.agentAuthorizedAt;
 s.applicationSettings={mode:'review',dailyLimit:12,minimumMatch:0,tutorialSeen:true,autoConsentAt:at};
 const before=structuredClone(s);assert.equal(d.getApplySettings(s).mode,'automatic');assert.equal(d.getApplySettings(s).dailyLimit,12);assert.deepEqual(s,before);
 s.jobs.push({...s.jobs[0],id:'new-job',url:'https://employer.example/new',disposition:'open'});
 const next=d.reduceAction(s,{type:'decide_job',jobId:'new-job',decision:'apply'},'interface',at).state;
 assert.equal(next.applications.find(r=>r.jobId==='new-job').status,'queued');
 assert.deepEqual(next.applications.find(r=>r.id===old.id),old);
});
test('missing automatic authorization prevents new work from being queued or claimed',()=>{
 const s=fixture();s.newApplicationAgent.issuedAt=undefined;
 const next=apply(s),r=next.applications[0];assert.equal(r.status,'needs_action');assert.equal(r.reason,'authorization_required');
 r.status='queued';r.agentVersion=2;r.agentAuthorizedAt=at;
 assert.equal(a.claimApplication(next,at),null);assert.equal(r.status,'needs_action');assert.equal(r.agentAuthorizedAt,undefined);
 assert.equal(p.applicationProgress(r).label,'Authorize Automatic Apply');
});
test('submission still requires current automatic authorization or an explicit request authorization',()=>{
 const s=apply(fixture()),r=a.claimApplication(s,at);assert.ok(r);assert.doesNotThrow(()=>a.assertApplicationAuthorizationCurrent(s,r));
 s.newApplicationAgent.issuedAt=undefined;assert.throws(()=>a.assertApplicationAuthorizationCurrent(s,r),/Authorize Automatic Apply/);
 r.reviewedForSubmissionAt=at;assert.doesNotThrow(()=>a.assertApplicationAuthorizationCurrent(s,r));
});
test('saving Automatic Apply does not restart paused, uncertain or confirmed requests',()=>{
 for(const status of ['needs_action','needs_attention','uncertain','applied']){
  const s=apply(fixture());s.applications[0].status=status;
  if(status==='uncertain')s.applications[0].report={journey:{possible_delivery:true}};
  const before=structuredClone(s.applications),saved=prefs(s,{});assert.deepEqual(saved.applications,before);
  assert.equal(a.claimApplication(saved,at),null);
  if(status==='uncertain')assert.equal(p.applicationProgress(saved.applications[0]).canQueue,false);
 }
});
