import assert from 'node:assert/strict';
const base=process.env.CYBER_TEST_BASE;
if(process.env.CYBER_ACCOUNT_DELETE_TEST!=='isolated'||!base||!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Account deletion QA requires an explicitly isolated loopback Site.');
const signin=await fetch(`${base}/signin-with-chatgpt?return_to=%2Faccount`,{redirect:'manual'});
assert.equal(signin.status,302);
const cookie=signin.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie?.startsWith('__sites_local_auth=1'));
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);console.log(`PASS ${++checks}: ${message}`);};
async function req(path,{method='GET',body,headers={},auth=true}={}){
 const response=await fetch(base+path,{method,redirect:'manual',headers:{...(auth?{Cookie:cookie}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:response.status,data};
}
let account=await req('/api/account');
ok(account.status===200&&account.data.revision===0&&account.data.files===0&&account.data.jobs===0&&account.data.applications===0,'isolated identity has no saved account data');
ok((await req('/api/account',{auth:false})).status===401,'anonymous account access denied');
ok((await req('/api/account',{method:'DELETE',body:{revision:0,confirmation:'DELETE CYBERAPPLY'},auth:false})).status===401,'anonymous account deletion denied');
let workspace=await req('/api/workspace');assert.equal(workspace.status,200,JSON.stringify(workspace.data));
async function act(action){const next=await req('/api/workspace',{method:'POST',body:{revision:workspace.data.revision,action}});assert.equal(next.status,200,JSON.stringify(next.data));workspace=next;}
await act({type:'complete_onboarding',fullName:'Account QA',headline:'Fictional test',targetRole:'SOC Analyst'});
await act({type:'add_job',title:'QA security analyst',company:'Example Test Company',location:'Remote',workMode:'Remote',url:'https://example.test/careers/qa',description:'Fictional cybersecurity role created for isolated account deletion QA.',skills:['SIEM']});
await act({type:'decide_job',jobId:workspace.data.state.jobs[0].id,decision:'apply'});
const form=new FormData();form.set('revision',String(workspace.data.revision));form.set('file',new File(['Account QA\nqa@example.test\nSOC Analyst with SIEM experience.'],'account-qa.txt',{type:'text/plain'}));
const uploaded=await req('/api/files',{method:'POST',body:form});assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));workspace=uploaded;
const fileId=workspace.data.state.attachments[0].id;
account=await req('/api/account');ok(account.data.files===1&&account.data.jobs===1&&account.data.applications===1,'account shows CV, job and Apply request before deletion');
ok((await req(`/api/files/${fileId}`)).status===200,'private original exists before deletion');
ok((await req('/api/history')).data.items.length>0,'revision history exists before deletion');
ok((await req('/api/account',{method:'DELETE',body:{revision:account.data.revision,confirmation:'wrong'}})).status===400,'deletion requires exact typed phrase');
ok((await req('/api/account',{method:'DELETE',body:{revision:account.data.revision-1,confirmation:'DELETE CYBERAPPLY'}})).status===409,'stale account revision cannot be deleted');
ok((await req('/api/account',{method:'DELETE',body:{revision:account.data.revision,confirmation:'DELETE CYBERAPPLY'},headers:{Origin:'https://other.example.test'}})).status===403,'cross-origin account deletion denied');
ok((await req('/api/account')).data.files===1,'rejected deletion leaves records intact');
const deleted=await req('/api/account',{method:'DELETE',body:{revision:account.data.revision,confirmation:'DELETE CYBERAPPLY'}});
assert.equal(deleted.status,200,JSON.stringify(deleted.data));ok(deleted.data.deleted===true,'confirmed deletion completes');
const after=await req('/api/account');ok(after.status===200&&after.data.files===0&&after.data.jobs===0&&after.data.applications===0,'new CyberApply account is empty after deletion');
ok((await req(`/api/files/${fileId}`)).status===404,'old CV original cannot be accessed');
ok((await req('/api/history')).data.items.length===0,'old revision history cannot be accessed');
const signout=await req('/signout-with-chatgpt?return_to=%2F');ok(signout.status===302,'platform sign-out route redirects');
ok((await req('/api/account',{auth:false})).status===401,'signed-out user cannot access account API');
console.log(JSON.stringify({checks,localOnly:true,isolated:true}));
