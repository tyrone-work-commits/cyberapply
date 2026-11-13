import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('.sites-runtime/presence-tests',{recursive:true});
await writeFile('.sites-runtime/presence-tests/presence.mjs',ts.transpileModule(await readFile('lib/agent-presence.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {runnerPresence}=await import('../.sites-runtime/presence-tests/presence.mjs');
const now=Date.parse('2026-10-29T12:00:00Z'),config={enabled:true,tokenHash:'new',expiresAt:'2026-11-29T12:00:00Z'};
test('a valid token alone does not report a running agent',()=>{assert.equal(runnerPresence(config,null,now).runnerState,'not_reporting');});
test('only fresh presence for this connection is active',()=>{
 const row={token_hash:'new',state:'working',seen_at:new Date(now-20000).toISOString()};
 assert.equal(runnerPresence(config,row,now).runnerState,'working');
 assert.equal(runnerPresence(config,{...row,seen_at:new Date(now-76000).toISOString()},now).runnerState,'not_reporting');
 assert.equal(runnerPresence(config,{...row,token_hash:'old'},now).runnerState,'not_reporting');
 assert.equal(runnerPresence(config,{...row,seen_at:new Date(now+1000).toISOString()},now).runnerState,'not_reporting');
});
test('stopped, expired and disconnected states cannot look online',()=>{
 const row={token_hash:'new',state:'stopped',seen_at:new Date(now).toISOString()};
 assert.equal(runnerPresence(config,row,now).runnerState,'stopped');
 assert.equal(runnerPresence({...config,expiresAt:'2026-01-01'},row,now).runnerState,'reconnect_required');
 assert.equal(runnerPresence(undefined,row,now).runnerState,'disconnected');
});
