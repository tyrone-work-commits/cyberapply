import {APP,jobUrl} from './protocol.js';
const $=id=>document.getElementById(id),message=async body=>{const result=await chrome.runtime.sendMessage(body);if(result?.error)throw Error(result.error);return result;};
async function action(fn){try{await fn();}catch(e){$('status').textContent=e.message;}}
$('settings').href=APP+'/workspace?view=extension';
$('open').onclick=()=>action(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});jobUrl(tab.url);await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});window.close();});
$('connect').onclick=()=>action(async()=>{await message({type:'connect',token:$('token').value.trim()});$('token').value='';$('status').textContent='Token stored for this browser session. Checking connection…';await recent();});
$('disconnect').onclick=()=>action(async()=>{await message({type:'disconnect'});$('status').textContent='Disconnected. You can still use the signed-in transfer screen.';});
$('transfer').onclick=()=>action(()=>message({type:'open-transfer'}));
async function recent(){const data=await message({type:'recent'});$('recent').replaceChildren();for(const item of data.items||[]){const li=document.createElement('li'),a=document.createElement('a');a.textContent=item.title+' — '+item.company;a.href=jobUrl(item.url);a.target='_blank';a.rel='noopener noreferrer';li.append(a);$('recent').append(li);}$('remaining').textContent=Number.isFinite(data.remaining)?`${data.remaining} scans remaining this month`:'Remaining scans available inside CyberApply.';if(data.notice)$('status').textContent=data.notice;}
void action(recent);
