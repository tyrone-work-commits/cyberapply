
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Run this check only against a local compiled Worker.');
const owner=`mcp-qa-${randomUUID()}`;
async function rpc(method,args={},signed=false){const response=await fetch(`${base}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(signed?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.test`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:args})});const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{throw Error(`${response.status}: ${raw}`);}return{status:response.status,body};}
let count=0;const ok=(value,message)=>{assert.ok(value,message);console.log(`PASS ${++count}: ${message}`);};
ok((await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'QA',version:'1'}})).body.result.protocolVersion==='2025-03-26','MCP stateless initialization');
const listing=await rpc('tools/list');ok(listing.body.result.tools.length===16&&!JSON.stringify(listing).includes(owner),'16 live-workspace tools discoverable without private records');
ok((await rpc('tools/call',{name:'get_workspace',arguments:{}})).status===401,'data calls require identity');
const call=async(name,args)=>{const result=await rpc('tools/call',{name,arguments:{mode:'personal',...args}},true);assert.equal(result.status,200);return result.body.result;};
let result=await call('get_workspace',{});ok(!result.isError,'authorized read works');const first=JSON.parse(result.content[0].text);
result=await call('add_job',{revision:first.revision,job:{title:'QA Analyst',company:'QA Company',location:'Remote',workMode:'Remote',url:'https://qa.example.test/jobs/analyst',description:'Local fixture for checking durable listing writes by an agent.',skills:['SIEM']}});ok(!result.isError,'authorized listing action works');
const headers={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.test`};const saved=await(await fetch(`${base}/api/workspace`,{headers})).json();ok(saved.state.jobs.length===1&&saved.state.activity[0].source==='agent','agent edits visible through the interface API');
result=await call('get_workspace',{owner_id:'other'});ok(result.isError,'owner injection rejected');
result=await call('save_job',{revision:String(saved.revision),jobId:saved.state.jobs[0].id,saved:true});ok(result.isError,'non-numeric revision rejected');
const malformed=await fetch(`${base}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});ok(malformed.status===400,'malformed envelope handled safely');
console.log(JSON.stringify({checks:count,localOnly:true}));
