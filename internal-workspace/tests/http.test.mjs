
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Only target a loopback compiled Worker. These headers simulate Sites dispatch locally.
// They must never be used to impersonate a hosted user or bypass the deployed Site gate.
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Integration checks require a loopback Worker.');
const owner=`qa-${randomUUID()}`,other=`qa-${randomUUID()}`;
const auth=(who=owner)=>({'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`});
async function req(path,{who=owner,method='GET',body,headers={}}={}){const response=await fetch(base+path,{method,headers:{...(who?auth(who):{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,data,headers:response.headers};}
let count=0;function ok(value,message){assert.ok(value,message);console.log(`PASS ${++count}: ${message}`);}
const anonymous=await req('/api/workspace',{who:null});ok(anonymous.status===401,'anonymous data access denied');
let current=(await req('/api/workspace')).data;ok(current.revision===0&&current.state.jobs.length===0,'new owner starts empty');
async function act(action,expected=200){const result=await req('/api/workspace',{method:'POST',body:{revision:current.revision,action}});assert.equal(result.status,expected,JSON.stringify(result.data));if(expected===200)current=result.data;return result;}
await act({type:'load_examples'});ok(current.state.jobs.length===4,'fictional examples load through D1');
await act({type:'decide_job',jobId:'sample-soc',decision:'prepare'},409);ok(current.state.drafts.length===0,'unreviewed profile cannot prepare a draft');
await act({type:'save_profile',profile:{fullName:'QA Candidate',email:'candidate@example.test',skills:['SIEM','Python'],preferredRoles:['SOC Analyst'],resumeText:'QA candidate has supplied SIEM and incident response practice facts for testing.',reviewed:true}});
await act({type:'decide_job',jobId:'sample-soc',decision:'prepare'});let draft=current.state.drafts[0];const originalRevision=current.revision,originalText=draft.text;
await act({type:'decide_job',jobId:'sample-soc',decision:'prepare'});ok(current.state.drafts.length===1,'repeat prepare does not duplicate drafts');
await act({type:'edit_draft',draftId:draft.id,text:'Exact revised draft text supplied by the QA candidate. Saved on the server.',expectedVersion:draft.version});draft=current.state.drafts[0];
const refreshed=(await req('/api/workspace')).data;ok(refreshed.state.drafts[0].text===draft.text&&refreshed.revision===current.revision,'draft edits survive a fresh read');
const past=await req(`/api/history?revision=${originalRevision}`);ok(past.status===200&&past.data.state.drafts[0].text===originalText,'earlier draft text is retained in immutable history');
const isolated=await req('/api/workspace',{who:other});ok(isolated.data.state.jobs.length===0&&isolated.data.state.drafts.length===0,'second owner cannot see candidate records');
const missing=await req(`/api/history?revision=${originalRevision}`,{who:other});ok(missing.status===404,'second owner cannot read first owner snapshot');
const simultaneous=await Promise.all(['ocean','forest'].map(theme=>req('/api/workspace',{method:'POST',body:{revision:current.revision,action:{type:'set_theme',theme}}})));ok(simultaneous.map(r=>r.status).sort().join(',')==='200,409','concurrent saves permit one winner and reject stale overwrite');current=(await req('/api/workspace')).data;
const afterRace=(await req('/api/history')).data.items;ok(afterRace.filter(item=>item.revision===current.revision).length===1,'conflicting save does not create duplicate or phantom history');
await act({type:'mark_ready',draftId:draft.id,expectedVersion:1,confirmation:'REVIEWED'},409);ok(true,'stale draft review rejected');
await act({type:'mark_ready',draftId:draft.id,expectedVersion:draft.version,confirmation:'REVIEWED'});ok(current.state.drafts[0].status==='ready','exact current draft can be marked ready without submitting');
const form=new FormData();form.set('revision',String(current.revision));const fileText='Imported QA resume text with Python and SIEM practice. User must review this again.';form.set('file',new File([fileText],'qa-resume.txt',{type:'text/plain'}));const uploaded=await req('/api/files',{method:'POST',body:form});assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));current=uploaded.data;const file=current.state.attachments[0];ok(current.state.profile.resumeText===fileText&&!current.state.profile.reviewed&&current.state.drafts[0].status==='draft','TXT upload persists text and invalidates previous review');
const downloaded=await req(`/api/files/${file.id}`);ok(downloaded.status===200&&downloaded.data===fileText,'owner can download exact private R2 content');ok((await req(`/api/files/${file.id}`,{who:other})).status===404,'second owner cannot download private file');
const bad=new FormData();bad.set('revision',String(current.revision));bad.set('file',new File(['not a PDF'],'fake.pdf'));ok((await req('/api/files',{method:'POST',body:bad})).status===400,'mislabelled upload rejected');
ok((await req('/api/workspace',{method:'POST',body:{revision:current.revision,action:{type:'set_theme',theme:'ember'}},headers:{Origin:'https://unrelated.example'}})).status===403,'cross-origin browser mutation denied');
const exported=await req('/api/export');ok(exported.status===200&&exported.data.state.drafts.length===1&&exported.headers.get('content-disposition')?.includes('attachment'),'owned current records export as a download');
console.log(JSON.stringify({checks:count,owner,latestRevision:current.revision,localOnly:true}));
