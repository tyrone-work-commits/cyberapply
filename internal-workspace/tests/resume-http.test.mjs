import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pdfCV,docxCV,strongCV,weakCV} from './resume-fixtures.mjs';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('CV checks require a loopback Worker. Never seed hosted profiles.');
const owner=`cv-qa-${randomUUID()}`,other=`cv-qa-${randomUUID()}`;let checks=0;
function ok(value,message){assert.ok(value,message);console.log(`PASS ${++checks}: ${message}`);}
const auth=who=>({'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`});
async function req(path,{who=owner,body,method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{...auth(who),Connection:'close',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:r.status,data};}
let current=(await req('/api/workspace')).data;
async function upload(bytes,name,revision=current.revision){const form=new FormData();form.set('revision',String(revision));form.set('file',new File([bytes],name));return req('/api/files',{body:form});}
for(const [bytes,name,format] of [[weakCV,'qa.txt','TXT'],[pdfCV(),'qa.pdf','PDF'],[docxCV(),'qa.docx','DOCX']]){
 const result=await upload(bytes,name);assert.equal(result.status,200,JSON.stringify(result.data));current=result.data;
 ok(current.state.resumeReview.score>=0&&current.state.resumeReview.checks.length===6&&current.state.resumeReview.source.format===format,`${format} upload immediately produces six scored checks`);
 ok(current.state.attachments[0].reviewSnapshot.score===current.state.resumeReview.score&&current.state.attachments[0].reviewSnapshot.at===current.state.resumeReview.at,`${format} stores its own file-linked score`);
 ok(current.state.profile.resumeText.includes(format==='TXT'?'Looking for a role':'Investigated 30 alerts')&&!current.state.profile.reviewed,`${format} extracts text and leaves candidate accuracy confirmation to the user`);
 const fresh=(await req('/api/workspace')).data;ok(JSON.stringify(fresh.state.resumeReview)===JSON.stringify(current.state.resumeReview),`${format} review survives reload`);
}
ok(current.state.profile.fullName==='QA Candidate'&&current.state.profile.email==='qa@example.test'&&current.state.profile.skills.includes('SIEM'),'clearly stated CV contact and skills fill candidate facts');
ok(current.state.profile.preferredRoles.length===0,'a preferred role is not invented from summary prose');
const targetedCV=strongCV.replace('QA Candidate','Amara Okafor').replace('qa@example.test','amara.okafor@example.test').replace('SUMMARY','Target role: SOC Analyst\nSUMMARY');
const targeted=await upload(targetedCV,'target-role.txt');assert.equal(targeted.status,200,JSON.stringify(targeted.data));current=targeted.data;
ok(current.state.profile.fullName==='Amara Okafor'&&current.state.profile.email==='amara.okafor@example.test','a newly uploaded CV replaces prior contact fields when stated');
ok(current.state.profile.preferredRoles[0]==='SOC Analyst'&&current.state.profile.skills.includes('Python')&&!current.state.profile.reviewed,'explicit target role and skills persist without confirming candidate accuracy');
ok((await req('/api/workspace')).data.state.profile.preferredRoles[0]==='SOC Analyst','autofilled facts survive workspace refresh');
const categorized=await upload(`Amara Okafor\namara.okafor@example.test\nSoftware Engineer\nTECHNICAL SKILLS\nProgramming Languages: Python, JavaScript\nFrontend: React, Next.js\nBackend: FastAPI, Node.js\nDatabases: PostgreSQL\nEXPERIENCE\n- Built secure services.`, 'categorized.txt');assert.equal(categorized.status,200,JSON.stringify(categorized.data));current=categorized.data;
ok(current.state.profile.preferredRoles[0]==='Software Engineer'&&['Python','Next.js','Node.js','PostgreSQL'].every(skill=>current.state.profile.skills.includes(skill))&&!current.state.profile.reviewed,'categorized skills and a common CV role headline fill candidate facts without confirming them');
const original=structuredClone(current);
for(const [bytes,name,expected] of [[pdfCV(''),'scanned.pdf',422],['not a pdf','wrong.pdf',422],['x'.repeat(120001),'long.txt',413],[docxCV(),'stale.docx',409]]){
 const result=await upload(bytes,name,name==='stale.docx'?current.revision-1:current.revision);ok(result.status===expected,`${name} is rejected with ${expected}`);
 const fresh=(await req('/api/workspace')).data;ok(JSON.stringify(fresh.state)===JSON.stringify(original.state)&&fresh.revision===original.revision,`${name} keeps the previous CV, review, files and revision unchanged`);
}
const file=current.state.attachments[0];const downloaded=await req(`/api/files/${file.id}`);ok(downloaded.status===200,'owner can download original Word file');ok((await req(`/api/files/${file.id}`,{who:other})).status===404,'other owner cannot download private CV');
ok((await req('/api/workspace',{who:other})).data.state.resumeReview===undefined,'another owner has no candidate review');
const history=(await req('/api/history')).data.items;ok(history.some(item=>item.action==='upload_file'),'upload and automatic review have durable history');
const profile={...current.state.profile,resumeText:strongCV+'\nAdditional truthful local test edit.'};
const edited=await req('/api/workspace',{body:{revision:current.revision,action:{type:'save_profile',profile}}});assert.equal(edited.status,200,JSON.stringify(edited.data));
ok(edited.data.state.resumeReview.source===undefined&&edited.data.state.resumeReview.words>current.state.resumeReview.words,'saving changed CV text automatically re-assesses it without stale upload attribution');

const recheckOwner=`cv-recheck-${randomUUID()}`;
let recheckState=(await req('/api/workspace',{who:recheckOwner})).data;
const linkedCV=`Amara Okafor\namara@example.test | Location: Lagos, Nigeria\nLinkedIn: www.linkedin.com/in/amara-okafor | Portfolio website: https://amara.example.test/\nTarget role: SOC Analyst\nSUMMARY\nSecurity analyst with incident response experience.\nSKILLS\nSIEM, Python\nPROJECTS\nGitHub: https://github.com/amara/security-toolkit\nEXPERIENCE\n- Investigated 30 alerts per day.`;
const recheckForm=new FormData();recheckForm.set('revision',String(recheckState.revision));recheckForm.set('file',new File([linkedCV],'linked-cv.txt'));
const linkedUpload=await req('/api/files',{who:recheckOwner,body:recheckForm});assert.equal(linkedUpload.status,200,JSON.stringify(linkedUpload.data));recheckState=linkedUpload.data;
ok(recheckState.state.profile.githubRepositoryUrl==='https://github.com/amara/security-toolkit'&&recheckState.state.profile.linkedInUrl==='https://www.linkedin.com/in/amara-okafor'&&recheckState.state.profile.portfolioWebsiteUrl==='https://amara.example.test/'&&recheckState.state.profile.location==='Lagos, Nigeria','upload fills all four added Candidate facts from clear CV labels');
const changedProfile={...recheckState.state.profile,fullName:'Prior name',email:'prior@example.test',skills:['Old skill'],preferredRoles:['Old role'],githubRepositoryUrl:'',linkedInUrl:'',portfolioWebsiteUrl:'',location:'',reviewed:true};
let changed=await req('/api/workspace',{who:recheckOwner,body:{revision:recheckState.revision,action:{type:'save_profile',profile:changedProfile}}});assert.equal(changed.status,200,JSON.stringify(changed.data));recheckState=changed.data;
const rechecked=await req('/api/workspace',{who:recheckOwner,body:{revision:recheckState.revision,action:{type:'review_resume'}}});assert.equal(rechecked.status,200,JSON.stringify(rechecked.data));recheckState=rechecked.data;
ok(recheckState.state.profile.fullName==='Amara Okafor'&&recheckState.state.profile.email==='amara@example.test'&&recheckState.state.profile.skills.join(',')==='SIEM,Python'&&recheckState.state.profile.preferredRoles[0]==='SOC Analyst','Recheck refills existing Candidate facts from the saved CV');
ok(recheckState.state.profile.githubRepositoryUrl==='https://github.com/amara/security-toolkit'&&recheckState.state.profile.linkedInUrl==='https://www.linkedin.com/in/amara-okafor'&&recheckState.state.profile.portfolioWebsiteUrl==='https://amara.example.test/'&&recheckState.state.profile.location==='Lagos, Nigeria','Recheck refills professional links and location');
ok(!recheckState.state.profile.reviewed&&recheckState.state.resumeReview.source.fileId===linkedUpload.data.state.resumeReview.source.fileId,'Recheck requires renewed accuracy confirmation while retaining the reviewed CV source');
const reloaded=(await req('/api/workspace',{who:recheckOwner})).data;
ok(reloaded.state.profile.githubRepositoryUrl===recheckState.state.profile.githubRepositoryUrl&&reloaded.state.profile.location==='Lagos, Nigeria','refilled Candidate facts survive a fresh server read');
console.log(JSON.stringify({checks,localOnly:true}));
