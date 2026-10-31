import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

await mkdir('.sites-runtime/candidate-tests',{recursive:true});
await writeFile('.sites-runtime/candidate-tests/candidate-facts.mjs',ts.transpileModule(await readFile('lib/candidate-facts.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {extractCandidateFacts}=await import('../.sites-runtime/candidate-tests/candidate-facts.mjs');

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
test('common role headlines and labelled skill categories yield clean candidate values',()=>{
 const facts=extractCandidateFacts(`Amara Okafor\nSoftware Engineer\namara@example.com\nTECHNICAL SKILLS\nProgramming Languages: Python, JavaScript\nFrontend: React, Next.js\nBackend: FastAPI, Node.js\nDatabases: PostgreSQL\nEXPERIENCE\n- Built secure services.`);
 assert.deepEqual(facts.preferredRoles,['Software Engineer']);
 assert.deepEqual(facts.skills,['Python','JavaScript','React','Next.js','FastAPI','Node.js','PostgreSQL']);
});

test('a labelled CV header and project link fill all Candidate facts without confusing a GitHub profile with a repository',()=>{
 const facts=extractCandidateFacts(`Amara Okafor
amara@example.test | Location: Lagos, Nigeria | GitHub: https://github.com/amara
LinkedIn: www.linkedin.com/in/amara-okafor | Portfolio website: https://amara.example.test/
Target role: SOC Analyst
SUMMARY
Security analyst with practical response experience.
SKILLS
SIEM, Python
PROJECTS
Security monitoring toolkit
GitHub: https://github.com/amara/security-toolkit
EXPERIENCE
- Investigated security alerts.`);
 assert.deepEqual(facts,{fullName:'Amara Okafor',email:'amara@example.test',preferredRoles:['SOC Analyst'],skills:['SIEM','Python'],githubRepositoryUrl:'https://github.com/amara/security-toolkit',linkedInUrl:'https://www.linkedin.com/in/amara-okafor',portfolioWebsiteUrl:'https://amara.example.test/',location:'Lagos, Nigeria'});
});

test('unsafe or unrelated URLs do not become candidate links',()=>{
 const facts=extractCandidateFacts(`Amara Okafor
GitHub: http://github.com/amara/security-toolkit
LinkedIn: https://evil.linkedin.com.example/in/amara
Portfolio website: https://name:secret@portfolio.example.test/
Location: +234 801 234 5678
PROJECTS
Live site: https://project.example.test/`);
 assert.equal(facts.githubRepositoryUrl,undefined);
 assert.equal(facts.linkedInUrl,undefined);
 assert.equal(facts.portfolioWebsiteUrl,undefined);
 assert.equal(facts.location,undefined);
});
