import assert from 'node:assert/strict';

const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Retired agent test requires a loopback Worker.');
const headers={'oai-authenticated-user-id':'retired-agent-test','oai-authenticated-user-email':'retired-agent@example.test',Authorization:'Bearer ca1.old-token'};

for(const [path,method] of [
  ['/api/agent/pair','GET'],['/api/agent/pair','POST'],['/api/agent/pair','DELETE'],
  ['/api/agent/claim','POST'],['/api/agent/cv?applicationId=old&claimId=old','GET'],
  ['/api/agent/result','POST'],
]){
  const response=await fetch(base+path,{method,headers,signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,410,`${method} ${path} must reject the old agent`);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  const body=await response.json();
  assert.match(body.error,/removed/);
  assert.equal(body.token,undefined);
  assert.equal(body.cv,undefined);
}
console.log('PASS: all retired agent routes reject pairing, claims, CV reads and results');
