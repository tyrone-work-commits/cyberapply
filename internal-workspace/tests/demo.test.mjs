import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local QA only. Never impersonate hosted users.');
const owner=`demo-qa-${randomUUID()}`,other=`demo-qa-${randomUUID()}`;
let count=0;const ok=(value,message)=>{assert.ok(value,message);console.log(`PASS ${++count}: ${message}`);};
async function req(path,{method='GET',body,who=owner,demo=true}={}){const suffix=demo?`${path.includes('?')?'&':'?'}mode=demo`:'';const response=await fetch(base+path+suffix,{method,headers:{...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,data};}
ok((await req('/api/workspace',{who:null})).status===401,'demo data still requires authentication');
let current=(await req('/api/workspace')).data;
ok(current.state.demo&&current.state.jobs.length===4&&current.state.drafts.length===2&&current.state.submissions[0].seeded&&current.state.resumeReview.score>0,'first demo load has fictional candidate, review, jobs, drafts and example receipt');
const personal=(await req('/api/workspace',{demo:false})).data;ok(personal.state.jobs.length===0&&!personal.state.demo&&personal.revision===0,'demo does not overwrite personal records');
async function act(action,expected=200){const result=await req('/api/workspace',{method:'POST',body:{revision:current.revision,action}});assert.equal(result.status,expected,JSON.stringify(result.data));if(expected===200)current=result.data;return result;}
const draft=current.state.drafts.find(d=>d.jobId==='sample-cloud');const sending={type:'simulate_apply',draftId:draft.id,expectedVersion:draft.version,confirmation:'SIMULATE'};
await act({...sending,expectedVersion:999},409);ok(true,'send rejects stale draft version');
await act(sending);const receipt=structuredClone(current.state.submissions[0]);const sentRevision=current.revision;
ok(current.state.submissions.length===2&&receipt.simulated&&receipt.text===draft.text&&receipt.draftVersion===draft.version,'simulated send saves exact material snapshot and receipt');
await act(sending);ok(current.state.submissions.length===2,'repeat simulated send cannot duplicate application');
ok((await req('/api/workspace')).data.state.submissions[0].id===receipt.id,'simulated receipt persists after fresh read');
ok((await req(`/api/receipts/${receipt.id}`)).data.includes(receipt.text),'owned receipt download includes exact sent draft');
ok((await req(`/api/receipts/${receipt.id}`,{who:other})).status===404,'another demo owner cannot download receipt');
ok((await req(`/api/receipts/${receipt.id}`,{demo:false})).status===404,'personal scope cannot download demo receipt');
await act({type:'edit_draft',draftId:draft.id,expectedVersion:draft.version,text:'Edited fictional application letter. This exact edit must survive refresh.'});
ok((await req('/api/workspace')).data.state.drafts.find(d=>d.id===draft.id).text.includes('exact edit'),'draft edit survives fresh read');
ok(current.state.submissions[0].text===receipt.text,'editing draft preserves sent snapshot');
await act({type:'simulate_apply',draftId:draft.id,expectedVersion:draft.version,confirmation:'SIMULATE'},409);ok(true,'stale reviewed version rejected after edit');
const high=current.state.resumeReview.score;
await act({type:'save_profile',profile:{...current.state.profile,resumeText:'A short fictional CV with no supported details.',reviewed:false}});ok(!current.state.resumeReview,'saved profile edits invalidate old CV report');
await act({type:'review_resume'});ok(current.state.resumeReview.score<high&&current.state.resumeReview.checks.length===6,'quality report responds to submitted CV text');
ok((await req(`/api/history?revision=${sentRevision}`)).data.state.submissions[0].text===receipt.text,'history preserves earlier CV and application snapshots');
ok((await req('/api/history',{demo:false})).data.items.length===0,'demo history is separate from personal history');
const exported=(await req('/api/export')).data;ok(exported.state.demo&&exported.state.submissions.length===2&&!exported.submissionConnected,'export includes clearly simulated evidence');
// Tool calls use the same default demo scope as the website.
async function tool(name,args={}){const r=await req('/mcp',{demo:false,method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});assert.equal(r.status,200);return r.data.result;}
let result=await tool('get_workspace');const summary=JSON.parse(result.content[0].text);ok(summary.workspaceMode==='demo'&&summary.revision===current.revision&&summary.simulatedApplications===2,'agent defaults to the same saved demo workspace');
result=await tool('get_demo_submissions');ok(JSON.parse(result.content[0].text).items[0].text===receipt.text,'agent reads exact simulated receipt snapshot');
result=await tool('review_resume',{revision:current.revision});ok(!result.isError,'agent can run CV quality review');
result=await tool('get_workspace',{mode:'wrong'});ok(result.isError,'invalid workspace scope rejected');
console.log(JSON.stringify({checks:count,localOnly:true}));
