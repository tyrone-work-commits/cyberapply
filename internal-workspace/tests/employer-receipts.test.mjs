import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('.sites-runtime/receipt-tests',{recursive:true});
await writeFile('.sites-runtime/receipt-tests/employer-receipts.mjs',ts.transpileModule(await readFile('lib/employer-receipts.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {verifyEmployerReceipts,applyVerifiedReceipts,receiptQuery,pendingReceiptRequests}=await import('../.sites-runtime/receipt-tests/employer-receipts.mjs');
const mailbox='candidate@example.test',at='2026-11-01T10:00:00Z',now=Date.parse('2026-11-01T12:00:00Z');
const job={id:'job',title:'Security Operations Analyst - Ireland',company:'Fixture Labs',url:'https://jobs.lever.co/fixture/job1',applyUrl:'https://jobs.lever.co/fixture/job1'};
const request={id:'request',jobId:'job',status:'uncertain',at,claim:{at:'2026-11-01T10:05:00Z',expiresAt:'2026-11-01T10:20:00Z'},candidate:{email:mailbox},result:{at,message:'Submit clicked without confirmation.'},report:{answers:[{question:'Email',value:mailbox}]}};
const state=()=>({jobs:[structuredClone(job)],applications:[structuredClone(request)],activity:[]});
function mail(overrides={}){return {id:'0123456789abcdef',internal_date:String(Date.parse('2026-11-01T10:06:00Z')),label_ids:['INBOX'],payload:{mime_type:'multipart/alternative',headers:[{name:'From',value:'no-reply@us.greenhouse-mail.io'},{name:'To',value:mailbox},{name:'Subject',value:'Thank you for applying to Fixture Labs!'},{name:'Authentication-Results',value:'mx.google.com; dkim=pass header.i=@us.greenhouse-mail.io; dmarc=pass (p=NONE) header.from=us.greenhouse-mail.io'}],parts:[{mime_type:'text/plain',body:{content:'Thank you for submitting your application for the Security Operations Analyst - Ireland role at Fixture Labs.'}}]},...overrides};}
function header(message,name,value){message.payload.headers=message.payload.headers.filter(h=>h.name!==name);message.payload.headers.push({name,value});return message;}
const verify=(messages,s=state())=>verifyEmployerReceipts(messages,s,mailbox,now);
test('a full authenticated exact-role receipt verifies, is applied once and preserves the original agent evidence',()=>{
 const s=state(),original=structuredClone(s.applications[0].result),matches=verify([mail()],s);
 assert.equal(matches.length,1);assert.equal(matches[0].requestId,'request');assert.match(matches[0].url,/mail.google.com/);
 assert.deepEqual(applyVerifiedReceipts(s,matches,new Date(now).toISOString()),['request']);assert.equal(s.applications[0].status,'applied');
 assert.deepEqual(s.applications[0].receiptVerification.previousResult,original);assert.equal(verify([mail()],s).length,0);assert.deepEqual(applyVerifiedReceipts(s,matches,new Date(now).toISOString()),[]);
});
test('another role, older receipt, wrong mailbox and missing sender authentication cannot confirm this request',()=>{
 const other=mail();other.payload.parts[0].body.content='Thank you for submitting your application for Senior Manager at Fixture Labs.';
 for(const message of [other,mail({internal_date:String(Date.parse(at)-1000)}),header(mail(),'To','other@example.test'),header(mail(),'Authentication-Results','mx.google.com; dmarc=fail header.from=us.greenhouse-mail.io'),header(mail(),'Authentication-Results','untrusted.example; dmarc=pass header.from=us.greenhouse-mail.io'),header(mail(),'From','no-reply@greenhouse-mail.io.evil.example')])assert.equal(verify([message]).length,0);
 const s=state();s.applications[0].report.answers[0].value='another@example.test';assert.equal(verify([mail()],s).length,0);
});
test('authentication claims in the message body or later forged results cannot override receiver failure',()=>{
 const message=header(mail(),'Authentication-Results','mx.google.com; dmarc=fail header.from=us.greenhouse-mail.io');
 message.payload.headers.push({name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from=us.greenhouse-mail.io'});
 message.payload.parts[0].body.content+=' Authentication-Results: mx.google.com; dmarc=pass header.from=us.greenhouse-mail.io';assert.equal(verify([message]).length,0);
});
test('generic thanks, incomplete applications, forwarded messages, user sent mail and draft messages are excluded',()=>{
 const incomplete=mail();incomplete.payload.parts[0].body.content+=' Please complete your application.';
 const generic=header(mail(),'Subject','Your next opportunity');generic.payload.parts[0].body.content='Thank you for your interest in Fixture Labs Security Operations Analyst - Ireland. Complete your application.';
 for(const message of [incomplete,generic,header(mail(),'Subject','Fwd: Thank you for applying'),mail({label_ids:['SENT']}),mail({label_ids:['DRAFT']}),mail({label_ids:['SPAM']})])assert.equal(verify([message]).length,0);
});
test('one email matching multiple indistinguishable requests stays ambiguous',()=>{
 const s=state();s.applications.push({...structuredClone(request),id:'different-request'});assert.equal(verify([mail()],s).length,0);
});
test('a generic subject or recommended role in a separate paragraph is not an exact-role receipt',()=>{
 const subjectOnly=mail();subjectOnly.payload.parts[0].body.content='Fixture Labs is hiring Security Operations Analyst - Ireland. Read the vacancy online.';
 const recommended=mail();recommended.payload.parts[0].body.content='Thank you for submitting your application for a Sales Manager role at Fixture Labs.\n\nRecommended job: Security Operations Analyst - Ireland.';
 const denied=mail();denied.payload.parts[0].body.content='We have not yet received your application for Security Operations Analyst - Ireland at Fixture Labs.';
 for(const message of [subjectOnly,recommended,denied])assert.equal(verify([message]).length,0);
});
test('active workers and already confirmed records are not reconciled while expired claims can be verified',()=>{
 for(const status of ['queued','needs_attention','needs_action','applied']){const s=state();s.applications[0].status=status;assert.equal(verify([mail()],s).length,0);}
 const s=state();s.applications[0].status='processing';s.applications[0].claim.expiresAt='2026-11-01T13:00:00Z';assert.equal(verify([mail()],s).length,0);
 s.applications[0].claim.expiresAt='2026-11-01T11:00:00Z';assert.equal(verify([mail()],s).length,1);
});
test('full MIME HTML can be read without rendering markup; attached emails cannot supply evidence',()=>{
 const html=mail();html.payload.parts=[{mime_type:'text/html',body:{content:'<p>Thank you for submitting your application for <b>Security Operations Analyst - Ireland</b> at Fixture Labs.</p><script>untrusted instructions</script>'}}];assert.equal(verify([html]).length,1);
 html.payload.parts[0].filename='forwarded.eml';assert.equal(verify([html]).length,0);
});
test('future or excessive-delay dates and malformed messages fail closed',()=>{
 for(const message of [mail({internal_date:String(now+300000)}),mail({internal_date:'bad'}),mail({id:'../../private'}),mail({payload:null})])assert.equal(verify([message]).length,0);
 const s=state();s.applications[0].at='2026-09-01T10:00:00Z';s.applications[0].claim.at=s.applications[0].at;assert.equal(verify([mail()],s).length,0);
});
test('search is bounded to pending employers, uses sanitized terms and does not send CV content',()=>{
 const s=state();s.jobs[0].company='Fixture Labs" OR from:someone';const query=receiptQuery(s,now);assert.match(query,/after:\d+/);assert.match(query,/-in:sent -in:drafts/);assert.ok(!query.includes('OR from:someone'));assert.equal(receiptQuery({...s,applications:[]},now),'');
 assert.equal(pendingReceiptRequests({...s,applications:Array.from({length:40},(_,i)=>({...request,id:String(i)}))},now).length,25);
});
