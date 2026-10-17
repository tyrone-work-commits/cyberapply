import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('.sites-runtime/source-tests',{recursive:true});
for(const name of ['cyber-domain','job-catalog','job-discovery']){
 const out=ts.transpileModule(await readFile(`lib/${name}.ts`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 await writeFile(`.sites-runtime/source-tests/${name}.mjs`,out);
}
const {boardFromUrl,searchSchema,defaultSearch,boardKey,matchesSearch,addRecommendedSources,recommendedBoards,MAX_EMPLOYER_BOARDS,broadCybersecurityQuery}=await import('../.sites-runtime/source-tests/job-catalog.mjs');
const {normalizeJob,discover,mergeDiscovery,fetchBoard}=await import('../.sites-runtime/source-tests/job-discovery.mjs');
const {emptyState,reduceAction}=await import('../.sites-runtime/source-tests/cyber-domain.mjs');
const at='2026-10-17T17:00:00.000Z';
const board={provider:'greenhouse',board:'qa',region:'global',company:'Local QA'};
const search={...defaultSearch,boards:[board]};
const raw={id:1,title:'Security Engineer',company_name:'Local QA',absolute_url:'https://job-boards.greenhouse.io/qa/jobs/1',location:{name:'Remote · UK'},content:'&lt;p&gt;Investigate incidents with &lt;strong&gt;SIEM&lt;/strong&gt; and Python.&lt;/p&gt;&lt;script&gt;steal()&lt;/script&gt;'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('board parsing fixes hosts and rejects private URLs, job URLs, credentials, query injection and duplicate sources',()=>{
 assert.equal(boardFromUrl('https://job-boards.greenhouse.io/huntress','Huntress').provider,'greenhouse');
 assert.equal(boardFromUrl('https://jobs.eu.lever.co/acme','Acme').region,'eu');
 for(const url of ['https://127.0.0.1/private','https://jobs.lever.co.evil.test/acme','https://u:p@jobs.lever.co/acme','https://jobs.lever.co/acme/job','https://jobs.lever.co/acme?next=http://localhost','https://jobs.lever.co:8080/acme'])assert.throws(()=>boardFromUrl(url,'Acme'));
 assert.equal(searchSchema.safeParse({...search,boards:[board,board]}).success,false);
});
test('Greenhouse normalization decodes escaped HTML, strips executable content and keeps real provenance',()=>{
 const job=normalizeJob(raw,board,at);assert.ok(job);assert.equal(job.company,'Local QA');assert.equal(job.workMode,'Remote');assert.equal(job.description,'Investigate incidents with SIEM and Python.');assert.ok(job.skills.includes('SIEM'));assert.equal(job.source.externalId,'1');assert.equal(job.source.checkedAt,at);assert.equal(job.source.availability,'open');assert.equal(job.applyUrl,raw.absolute_url);
 assert.equal(normalizeJob({...raw,absolute_url:'javascript:alert(1)'},board,at),null);
 assert.equal(normalizeJob({...raw,content:''},board,at),null);
});
test('Lever normalization preserves application URL and requirements lists',()=>{
 const job=normalizeJob({id:'a',text:'Threat Researcher',hostedUrl:'https://jobs.lever.co/qa/a',applyUrl:'https://jobs.lever.co/qa/a/apply',workplaceType:'hybrid',categories:{location:'London'},descriptionPlain:'Research cyber threats with evidence.',lists:[{text:'Requirements',content:'<li>Python and Linux experience</li>'}]},{...board,provider:'lever'},at);
 assert.equal(job.workMode,'Hybrid');assert.ok(job.description.includes('Python and Linux'));assert.ok(job.applyUrl.endsWith('/apply'));
});
test('remote filtering uses an explicit vacancy location rather than company boilerplate',()=>{
 const explicit=normalizeJob({...raw,location:{name:'United States'},content:'<p>Location: Remote US</p><p>Investigate security events with SIEM evidence.</p>'},board,at);
 assert.equal(explicit.workMode,'Remote');assert.ok(explicit.location.includes('Remote US'));
 const boilerplate=normalizeJob({...raw,location:{name:'United States'},content:'A remote-first company hiring a Security Engineer to investigate SIEM evidence.'},board,at);
 assert.equal(boilerplate.workMode,'Unspecified');
});
test('discovery filters cybersecurity titles and respects role, location and remote filters without candidate data',async()=>{
 const urls=[];const result=await discover({...search,keyword:'Security',location:'UK',remoteOnly:true},async(url,options)=>{urls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.body,undefined);assert.deepEqual(Object.keys(options.headers),['Accept']);return json({jobs:[raw,{...raw,id:2,title:'Account Executive'},{...raw,id:3,location:{name:'Hybrid · UK'}}]});},at);
 assert.equal(result.results[0].jobs.length,1);assert.ok(urls[0].startsWith('https://boards-api.greenhouse.io/v1/boards/qa/jobs?'));
 assert.equal(matchesSearch({title:'Security Engineer',location:'Remote · US',workMode:'Remote'},{keyword:'',location:'UK',remoteOnly:true}),false);
});
test('Lever pagination requests fixed hosts and reads every returned page',async()=>{
 let calls=0;const lever={...board,provider:'lever',region:'eu'};
 const result=await fetchBoard(lever,{...search,boards:[lever]},at,async url=>{calls++;assert.ok(url.startsWith('https://api.eu.lever.co/v0/postings/qa?'));if(calls===1)return json(Array.from({length:250},(_,id)=>({id,text:'SOC Analyst',hostedUrl:`https://jobs.eu.lever.co/qa/${id}`,descriptionPlain:'Investigate security incidents with SIEM evidence.'})));assert.ok(url.includes('skip=250'));return json([]);});
 assert.equal(calls,2);assert.equal(result.jobs.length,250);assert.equal(result.report.complete,true);
});
test('partial employer failures preserve other real results and never mark unseen jobs closed',async()=>{
 const current=emptyState();current.jobs=[normalizeJob(raw,board,at)];const other={...board,provider:'lever',board:'other'};
 const result=await discover({...search,boards:[board,other]},async url=>url.includes('greenhouse')?json({error:'unavailable'},503):json([{id:'x',text:'SOC Analyst',hostedUrl:'https://jobs.lever.co/other/x',descriptionPlain:'Investigate security incidents and SIEM events.'}]),at);
 const merged=mergeDiscovery(current,result.settings,result.results,at,'interface');assert.equal(merged.state.jobs[0].source.availability,'open');assert.equal(merged.report.boards[0].status,'error');assert.equal(merged.report.added,1);
});
test('successful complete scans mark disappeared jobs unavailable and block Apply',async()=>{
 const state=emptyState();state.jobs=[normalizeJob(raw,board,at)];
 const result=await discover(search,async()=>json({jobs:[]}),at);const merged=mergeDiscovery(state,search,result.results,at,'interface');assert.equal(merged.report.closed,1);assert.equal(merged.state.jobs[0].source.availability,'closed');assert.throws(()=>reduceAction(merged.state,{type:'decide_job',jobId:state.jobs[0].id,decision:'apply'},'interface',at),/no longer listed/);
 assert.equal(state.jobs[0].source.availability,'open');
});
test('refresh updates a saved role without duplicating it or erasing a decision, draft or request',async()=>{
 const state=emptyState();const job=normalizeJob(raw,board,at);job.saved=true;job.disposition='apply_requested';state.jobs=[job];state.drafts=[{id:'draft',jobId:job.id,text:'Exact user edits remain here.',version:2,status:'draft',createdAt:at,updatedAt:at}];state.applications=[{id:'request',jobId:job.id,draftId:'draft',text:'Original request snapshot',status:'needs_action'}];
 const result=await discover(search,async()=>json({jobs:[{...raw,title:'Senior Security Engineer'}]}),at);const merged=mergeDiscovery(state,search,result.results,at,'agent');assert.equal(merged.state.jobs.length,1);assert.equal(merged.state.jobs[0].title,'Senior Security Engineer');assert.equal(merged.state.jobs[0].saved,true);assert.equal(merged.state.jobs[0].disposition,'apply_requested');assert.deepEqual(merged.state.drafts,state.drafts);assert.deepEqual(merged.state.applications,state.applications);assert.equal(merged.state.activity[0].source,'agent');
});
test('incomplete scans preserve unseen vacancies and URL duplicates retain their original record ID',()=>{
 const state=emptyState();const job=normalizeJob(raw,board,at);job.id='original-manual-id';job.saved=true;state.jobs=[job];
 const empty={board,jobs:[],seen:[],report:{key:boardKey(board),company:board.company,provider:board.provider,status:'ok',fetched:1000,matching:0,complete:false}};
 assert.equal(mergeDiscovery(state,search,[empty],at,'interface').state.jobs[0].source.availability,'open');
 const fresh=normalizeJob(raw,board,at);const next=mergeDiscovery(state,search,[{...empty,jobs:[fresh],seen:['1']}],at,'interface');
 assert.equal(next.state.jobs.length,1);assert.equal(next.state.jobs[0].id,'original-manual-id');assert.equal(next.state.jobs[0].saved,true);
});
test('oversized and malformed feeds are reported without importing or claiming success',async()=>{
 for(const response of [new Response(null,{status:302,headers:{Location:'http://127.0.0.1/'}}),new Response('html',{headers:{'Content-Type':'text/html'}}),json({notJobs:[]}),new Response('x'.repeat(8_000_001),{headers:{'Content-Type':'application/json'}})]){const result=await discover(search,async()=>response,at);assert.equal(result.results[0].report.status,'error');assert.equal(result.results[0].jobs.length,0);}
});
test('imports bound description length, new roles, and do not trust caller-supplied source records',async()=>{
 const result=await discover(search,async()=>json({jobs:Array.from({length:40},(_,i)=>({...raw,id:i,absolute_url:`https://job-boards.greenhouse.io/qa/jobs/${i}`,content:'Python security requirements. '.repeat(400)}))}),at);
 const merged=mergeDiscovery(emptyState(),search,result.results,at,'interface');assert.equal(merged.report.added,24);assert.equal(merged.report.omitted,16);assert.ok(merged.state.jobs.every(job=>job.description.length<=6500&&job.source.descriptionTruncated));assert.equal(merged.state.discovery.lastSearch.at,at);
});


test('cybersecurity is a broad category while location, remote and specific role terms remain exact',()=>{
 const filters={keyword:'CyberSecurity',location:'',remoteOnly:false};
 for(const title of ['SOC Analyst','Security Engineer','Incident Response Analyst','GRC Analyst','Threat Researcher','DevSecOps Engineer'])assert.equal(matchesSearch({title,location:'Remote US',workMode:'Remote'},filters),true,title);
 for(const keyword of ['cyber security','cyber-security','cybersecurity jobs','information security','infosec']){assert.equal(broadCybersecurityQuery(keyword),true);assert.equal(matchesSearch({title:'SOC Analyst',location:'Remote US',workMode:'Remote'},{...filters,keyword}),true);}
 assert.equal(matchesSearch({title:'Account Executive',department:'Sales',location:'Remote US',workMode:'Remote'},filters),false);
 assert.equal(matchesSearch({title:'Security Engineer',location:'UK',workMode:'Remote'},{...filters,location:'Texas'}),false);
 assert.equal(matchesSearch({title:'Security Engineer',location:'Texas',workMode:'Hybrid'},{...filters,remoteOnly:true}),false);
 assert.equal(matchesSearch({title:'Security Analyst',location:'Texas',workMode:'Remote'},{...filters,keyword:'Security Engineer'}),false);
});
test('source departments survive normalization and keep broad search consistent after refresh',async()=>{
 const data={...raw,title:'Senior Software Engineer',departments:[{name:'<b>Security Research</b>'}]};
 const found=await discover({...search,keyword:'cybersecurity'},async()=>json({jobs:[data,{...data,id:2,departments:[{name:'Business Systems'}]}]}),at);
 assert.equal(found.results[0].jobs.length,1);const job=found.results[0].jobs[0];assert.equal(job.department,'Security Research');assert.equal(matchesSearch(job,found.settings),true);
 const saved=mergeDiscovery(emptyState(),found.settings,found.results,at,'interface').state;assert.equal(matchesSearch(JSON.parse(JSON.stringify(saved.jobs[0])),found.settings),true);
});
test('eight verified presets and ten-board limits are shared without resetting saved filters or custom boards',()=>{
 assert.equal(defaultSearch.boards.length,8);assert.equal(new Set(defaultSearch.boards.map(boardKey)).size,8);assert.equal(MAX_EMPLOYER_BOARDS,10);
 assert.ok(['guidepointsecurity','knowbe4','abnormalsecurity','wizinc','chainguard'].every(name=>recommendedBoards.some(b=>b.board===name)));
 const legacy={...defaultSearch,boards:defaultSearch.boards.slice(0,3),keyword:'cybersecurity',location:'Texas',remoteOnly:true};const expanded=addRecommendedSources(legacy);
 assert.equal(legacy.boards.length,3);assert.equal(expanded.boards.length,8);assert.equal(expanded.keyword,legacy.keyword);assert.equal(expanded.location,'Texas');assert.equal(expanded.remoteOnly,true);assert.deepEqual(addRecommendedSources(expanded),expanded);
 const custom={...legacy,boards:Array.from({length:9},(_,i)=>({...board,board:`custom${i}`}))};assert.equal(addRecommendedSources(custom).boards.length,10);assert.deepEqual(addRecommendedSources(custom).boards.slice(0,9),custom.boards);
 const ten={...legacy,boards:Array.from({length:10},(_,i)=>({...board,board:`board${i}`}))};assert.equal(searchSchema.safeParse(ten).success,true);assert.equal(searchSchema.safeParse({...ten,boards:[...ten.boards,{...board,board:'eleventh'}]}).success,false);
});
test('larger searches run at most three feeds concurrently and retain requested source ordering',async()=>{
 let active=0,peak=0;const boards=Array.from({length:10},(_,i)=>({...board,board:`qa${i}`}));
 const found=await discover({...search,boards},async url=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return url.includes('/qa4/')?json({},503):json({jobs:[raw]});},at);
 assert.equal(peak,3);assert.equal(found.results.length,10);assert.deepEqual(found.results.map(r=>r.board.board),boards.map(b=>b.board));assert.equal(found.results[4].report.status,'error');assert.ok(found.results.filter((_,i)=>i!==4).every(r=>r.report.status==='ok'));
});
