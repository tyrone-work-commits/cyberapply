import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {docxCV,pdfCV,weakCV} from './resume-fixtures.mjs';
const base=process.env.CYBER_TEST_BASE||'http://127.0.0.1:8787';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('File QA requires a loopback Worker. Never modify hosted CVs.');
const owner=`files-${randomUUID()}`,other=`files-${randomUUID()}`;let count=0;
const ok=(v,m)=>{assert.ok(v,m);console.log(`PASS ${++count}: ${m}`);};
async function req(path,{who=owner,method='GET',body,headers={}}={}){const r=await fetch(base+path,{method,signal:AbortSignal.timeout(20000),headers:{Connection:'close',...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':`${who}@example.test`}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:r.status,data,headers:r.headers};}
let current=(await req('/api/workspace')).data;
async function upload(bytes,name){const form=new FormData();form.set('revision',String(current.revision));form.set('file',new File([bytes],name));const r=await req('/api/files',{method:'POST',body:form});assert.equal(r.status,200,JSON.stringify(r.data));current=r.data;return current.state.attachments[0];}
const txt=await upload(weakCV,'qa-actions.txt'),pdf=await upload(pdfCV(),'qa-actions.pdf'),word=await upload(docxCV(weakCV+'\n<script>alert(1)</script>'),'qa-actions.docx');
for(const file of [txt,pdf,word]){
 const view=await req(`/api/files/${file.id}?view=1`);ok(view.status===200,`${file.name} can be viewed by its owner`);
 ok(view.headers.get('cache-control')==='private, no-store'&&view.headers.get('x-content-type-options')==='nosniff'&&view.headers.get('referrer-policy')==='no-referrer',`${file.name} preview is private and not cached`);
 if(file===word)ok(view.headers.get('content-type').startsWith('text/html')&&view.headers.get('content-security-policy').includes("default-src 'none'")&&!view.data.includes('<script>')&&view.data.includes('&lt;script&gt;'),'Word text preview escapes uploaded markup and blocks external content');
 else ok(view.headers.get('content-disposition').startsWith('inline;'),`${file.name} opens inline`);
 const original=await req(`/api/files/${file.id}`);ok(original.status===200&&original.headers.get('content-disposition').startsWith('attachment;'),`${file.name} original still downloads`);
 ok((await req(`/api/files/${file.id}?view=1`,{who:other})).status===404,`${file.name} preview is owner-only`);
}
ok((await req(`/api/files/${pdf.id}?view=1`,{who:null})).status===401,'anonymous preview denied');
const before=structuredClone(current),path=`/api/files/${pdf.id}`;
ok((await req(path,{method:'DELETE',body:{revision:current.revision-1,confirmation:'DELETE_FILE'}})).status===409,'stale deletion cannot remove a file');
ok((await req(path,{method:'DELETE',body:{revision:current.revision}})).status===400,'deletion requires explicit confirmation');
ok((await req(path,{method:'DELETE',who:other,body:{revision:0,confirmation:'DELETE_FILE'}})).status===404,'another owner cannot delete the file');
ok(JSON.stringify((await req('/api/workspace')).data.state)===JSON.stringify(before.state),'rejected deletions leave existing records unchanged');
const deleted=await req(path,{method:'DELETE',body:{revision:current.revision,confirmation:'DELETE_FILE'}});assert.equal(deleted.status,200,JSON.stringify(deleted.data));current=deleted.data;
ok(current.state.attachments.length===2&&!current.state.pendingFileDeletions,'confirmed deletion removes exactly the selected original and finishes cleanup');
ok(JSON.stringify(current.state.profile)===JSON.stringify(before.state.profile)&&JSON.stringify(current.state.resumeReview)===JSON.stringify(before.state.resumeReview),'deletion preserves the CV text, review and candidate accuracy status');
ok((await req(path)).status===404&&(await req(path+'?view=1')).status===404,'deleted original cannot be downloaded or viewed');
ok((await req(`/api/files/${word.id}`)).status===200,'another saved original stays available');
const fresh=(await req('/api/workspace')).data;ok(!fresh.state.attachments.some(f=>f.id===pdf.id),'deletion persists after reload');
const history=(await req('/api/history')).data.items;ok(history.some(item=>item.action==='delete_file')&&history.some(item=>item.action==='finish_file_deletion'),'deletion and cleanup have private durable history');
// Keep early body rejections last on Windows Wrangler.
ok((await req(`/api/files/${word.id}`,{method:'DELETE',body:{revision:current.revision,confirmation:'DELETE_FILE'},headers:{Origin:'https://unrelated.example'}})).status===403,'cross-origin deletion denied');
console.log(JSON.stringify({checks:count,localOnly:true}));
