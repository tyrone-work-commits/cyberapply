import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8797';if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Isolated loopback Worker only.');
const owner='unlimited-'+randomUUID(),auth={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'fictional@example.test'};let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function call(path,{body,headers=auth}={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
let current=(await call('/api/workspace')).data;
let r=await call('/api/application-settings');eq(r.status,200);eq(r.data.unlimited,true);eq(r.data.remaining,null);eq(r.data.settings.dailyLimit,null);eq(r.data.started,0);
for(const extra of [{dailyLimit:1},{dailyLimit:10000},{dailyLimit:null},{}]){
 r=await call('/api/application-settings',{body:{revision:current.revision,mode:'automatic',minimumMatch:25,authorizeAutomatic:true,tutorialSeen:true,...extra}});
 eq(r.status,200);current=r.data;eq(current.state.applicationSettings.dailyLimit,null);eq(current.state.applicationSettings.minimumMatch,25);
 r=await call('/api/application-settings');eq(r.data.unlimited,true);eq(r.data.remaining,null);eq(r.data.settings.dailyLimit,null);
}
eq((await call('/api/application-settings',{body:{revision:current.revision,mode:'automatic',minimumMatch:101}})).status,400);
eq((await call('/api/application-settings',{body:{revision:current.revision,mode:'review',minimumMatch:0}})).status,400);
eq((await call('/api/application-settings',{headers:{}})).status,401);
const other=await call('/api/application-settings',{headers:{'oai-authenticated-user-id':owner+'-other','oai-authenticated-user-email':'other@example.test'}});eq(other.status,200);eq(other.data.settings.minimumMatch,0);eq(other.data.unlimited,true);
eq((await call('/api/workspace')).data.revision,current.revision);
console.log(`PASS ${checks} unlimited-run HTTP checks: JSON-safe unlimited values, old/omitted/null cap compatibility, settings validation, authorization and owner isolation.`);
