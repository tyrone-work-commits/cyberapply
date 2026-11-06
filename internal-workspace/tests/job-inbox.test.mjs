import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

await mkdir('.sites-runtime/inbox-tests',{recursive:true});
await writeFile('.sites-runtime/inbox-tests/job-inbox.mjs',ts.transpileModule(await readFile('lib/job-inbox.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {inboxQuery,matchingInboxMessages}=await import('../.sites-runtime/inbox-tests/job-inbox.mjs');
const jobs=[{id:'bitwealth',title:'Cybersecurity Trainee',company:'Bitwealth Systems Limited',url:'https://www.bitwealthsystems.com.ng/careers'},{id:'other',title:'SOC Analyst',company:'Example Security',url:'https://jobs.lever.co/examplesecurity/123'}];
const applications=[{jobId:'bitwealth'},{jobId:'other'}];

test('search is confined to Inbox and known application employers',()=>{
 const query=inboxQuery(jobs,applications);
 assert.match(query,/in:inbox -in:spam -in:trash/);
 assert.match(query,/bitwealth systems/);
 assert.match(query,/from:bitwealthsystems.com.ng/);
 assert.equal(inboxQuery(jobs,[]),'');
});

test('only employer-related application mail is returned, with safe links',()=>{
 const rows=[
  {id:'receipt',subject:'New Application: Cybersecurity Trainee',from_:'Bitwealth Careers <careers@bitwealthsystems.com.ng>',snippet:'We received your application.',email_ts:'2026-10-25T18:57:35Z',display_url:'https://mail.google.com/mail/u/0/#inbox/receipt',labels:['INBOX','UNREAD']},
  {id:'unrelated',subject:'Your interview',from_:'Other Company <hr@other.example>',snippet:'We look forward to meeting.',display_url:'https://mail.google.com/mail/u/0/#inbox/unrelated'},
  {id:'alert',subject:'New jobs for you',from_:'Bitwealth Careers <careers@bitwealthsystems.com.ng>',snippet:'Recommended jobs this week.'},
  {id:'phish',subject:'Your application to Example Security',from_:'Someone <mail@unrelated.example>',snippet:'Click here for your application.',display_url:'https://evil.example/steal'},
  {id:'ats',subject:'Your application to Example Security',from_:'Hiring <notifications@lever.co>',snippet:'Application received.',display_url:'https://evil.example/steal'},
 ];
 const result=matchingInboxMessages(rows,jobs,applications);
 assert.deepEqual(result.map(row=>row.id),['receipt','ats']);
 assert.equal(result[0].unread,true);
 assert.equal(result[1].url,'');
});

test('malformed dates do not break the inbox',()=>{
 const result=matchingInboxMessages([{id:'x',subject:'Application received',from_:'HR <hr@bitwealthsystems.com.ng>',snippet:'Thanks',email_ts:'not-a-date'}],jobs,applications);
 assert.equal(result[0].receivedAt,'');
});
