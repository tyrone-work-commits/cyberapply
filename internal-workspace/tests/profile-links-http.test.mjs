import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Profile checks require a loopback Worker.');
const owner=`links-qa-${randomUUID()}`;
let checks=0;
function ok(condition,message){assert.ok(condition,message);console.log(`PASS ${++checks}: ${message}`);}
async function request(who,path,body){
 const response=await fetch(base+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(20000),headers:{'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
}
let current=(await request(owner,'/api/workspace')).data;
const profile={fullName:'Amara Okafor',email:'amara@example.test',skills:['SIEM'],preferredRoles:['SOC Analyst'],resumeText:'Amara Okafor has supplied security experience and SIEM practice for this local test.',reviewed:false};
const links={githubRepositoryUrl:'https://github.com/example/security-tool',linkedInUrl:'https://www.linkedin.com/in/amara-okafor',portfolioWebsiteUrl:'https://portfolio.example.test',location:'Lagos, Nigeria'};
let saved=await request(owner,'/api/workspace',{revision:current.revision,action:{type:'save_profile',profile:{...profile,...links}}});assert.equal(saved.status,200,JSON.stringify(saved.data));current=saved.data;
ok(Object.entries(links).every(([key,value])=>current.state.profile[key]===value),'all four Candidate facts save together');
let fresh=(await request(owner,'/api/workspace')).data;
ok(Object.entries(links).every(([key,value])=>fresh.state.profile[key]===value),'all four fields survive a fresh server read');
saved=await request(owner,'/api/workspace',{revision:fresh.revision,action:{type:'save_profile',profile}});assert.equal(saved.status,200,JSON.stringify(saved.data));current=saved.data;
ok(Object.entries(links).every(([key,value])=>current.state.profile[key]===value),'older clients omitting new fields do not erase them');
const rejected=await request(owner,'/api/workspace',{revision:current.revision,action:{type:'save_profile',profile:{...profile,linkedInUrl:'javascript:alert(1)'}}});
ok(rejected.status===400,'unsafe candidate links are rejected');
fresh=(await request(owner,'/api/workspace')).data;
ok(fresh.revision===current.revision&&fresh.state.profile.linkedInUrl===links.linkedInUrl,'invalid saves leave prior candidate links intact');
const other=(await request(`other-${randomUUID()}`,'/api/workspace')).data;
ok(!other.state.profile.githubRepositoryUrl&&!other.state.profile.linkedInUrl,'another account cannot see the saved links');
console.log(JSON.stringify({checks,localOnly:true}));
