import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
// These harnesses require a dedicated disposable HTTP server and explicit mock
// identities. Never point them at the developer's retained preview or live Site.
const integration=new Set(['http.test.mjs','job-live.test.mjs','live-workspace.test.mjs','mcp.test.mjs','onboarding.test.mjs']);
const files=(await readdir('tests')).filter(name=>name.endsWith('.test.mjs')&&!name.endsWith('-http.test.mjs')&&!integration.has(name)).sort();
console.log(`Running ${files.length} offline test files. Separate HTTP harnesses need their documented isolated server.`);
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files.map(name=>'tests/'+name)],{stdio:'inherit'});process.exitCode=result.status??1;
