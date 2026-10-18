import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

await mkdir('.sites-runtime/tests',{recursive:true});
await writeFile('.sites-runtime/tests/candidate-facts.mjs',ts.transpileModule(await readFile('lib/candidate-facts.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {extractCandidateFacts}=await import('../.sites-runtime/tests/candidate-facts.mjs');

test('explicit CV name, email, skills and preferred role fill candidate fields',()=>{
 const facts=extractCandidateFacts(`Amara Okafor\namara.okafor@example.com | +234 801 234 5678\nTarget role: SOC Analyst, Security Engineer\nSUMMARY\nWorked with security teams.\nSKILLS\nSIEM, Python, Incident response\nEDUCATION\nSecurity studies.`);
 assert.deepEqual(facts,{fullName:'Amara Okafor',email:'amara.okafor@example.com',preferredRoles:['SOC Analyst','Security Engineer'],skills:['SIEM','Python','Incident response']});
});
test('unlabelled prose does not become a skill or preferred role',()=>{
 const facts=extractCandidateFacts(`Amara Okafor\namara@example.com\nSUMMARY\nI worked with security analysts and discussed Python briefly.\nEXPERIENCE\n- Supported incident response.\nEDUCATION\nSecurity studies.`);
 assert.equal(facts.fullName,'Amara Okafor');assert.equal(facts.email,'amara@example.com');assert.equal(facts.skills,undefined);assert.equal(facts.preferredRoles,undefined);
});
test('a CV headline can supply a stated role without mistaking it for a name',()=>{
 const facts=extractCandidateFacts(`Amara Okafor\nCloud Security Engineer\namara@example.com\nTECHNICAL SKILLS: AWS, Linux, Python\nEXPERIENCE\n- Built controls.`);
 assert.equal(facts.fullName,'Amara Okafor');assert.deepEqual(facts.preferredRoles,['Cloud Security Engineer']);assert.deepEqual(facts.skills,['AWS','Linux','Python']);
});
