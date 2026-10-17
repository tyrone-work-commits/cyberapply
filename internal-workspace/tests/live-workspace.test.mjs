import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local-only acceptance checks.');
const owner=`live-qa-${randomUUID()}`;let checks=0;
const ok=(v,m)=>{assert.ok(v,m);console.log(`PASS ${++checks}: ${m}`);};
async function req(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.test`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:r.status,data};}
let s=(await req('/api/workspace')).data;
ok(s.state.jobs.length===0&&s.connections.jobDiscovery.greenhouse==='available'&&!s.connections.automaticApplications,'no fabricated feed or claimed connection');
for(const path of ['/api/workspace?mode=demo','/api/history?mode=demo','/api/export?mode=demo','/api/files/x?mode=demo'])ok((await req(path)).status===410,`${path} is retired`);
ok((await req('/api/workspace',{revision:s.revision,action:{type:'load_examples'}})).status===400,'example seeding action removed');
ok((await req('/api/workspace',{revision:s.revision,action:{type:'simulate_apply',draftId:'x',expectedVersion:1,confirmation:'SIMULATE'}})).status===400,'simulated sending action removed');
const rpc=async(name,args={})=>(await req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})).data.result;
ok((await rpc('get_workspace',{mode:'demo'})).isError,'stale agent scope cannot access archived data');
ok((await rpc('simulate_application',{revision:0})).isError&&(await rpc('load_example_jobs',{revision:0})).isError,'retired agent actions unavailable');
async function act(action){const r=await req('/api/workspace',{revision:s.revision,action});assert.equal(r.status,200,JSON.stringify(r.data));s=r.data;}
await act({type:'add_job',title:'Local acceptance role',company:'Local QA fixture',location:'Remote',workMode:'Remote',url:'https://qa.example.test/role',description:'Local fixture for source attribution and request persistence.',skills:['SIEM']});const jobId=s.state.jobs[0].id;
await act({type:'save_profile',profile:{fullName:'Local QA',email:'qa@example.test',skills:['SIEM'],preferredRoles:['SOC Analyst'],resumeText:'Local QA supplied SIEM practice facts for testing application persistence.',reviewed:true}});
await act({type:'decide_job',jobId,decision:'apply'});
const original=structuredClone(s.state.applications[0]);
ok(original.status==='needs_action'&&!('submissions' in s.state),'Apply request stays explicitly unsent');
const fresh=(await req('/api/workspace')).data;
ok(JSON.stringify(fresh.state.applications[0])===JSON.stringify(original),'request and exact materials survive reload');
const tool=await rpc('get_application_requests');
ok(!tool.isError&&JSON.parse(tool.content[0].text).items[0].id===original.id,'agent and interface read the same saved request');
const exported=(await req('/api/export')).data;
ok(exported.submissionConnected===false&&exported.state.applications[0].id===original.id&&!('submissions'in exported.state),'export contains request evidence without simulated receipts');
console.log(JSON.stringify({checks,localOnly:true}));
