import { identity, load, response, failure } from '@/lib/cyber-store';
import { connectorsForRequest, type ConnectorResult } from '@/lib/connectors';
import {listCareer} from '@/lib/career-store';
import { inboxQuery, matchingInboxMessages, type MailRow } from '@/lib/job-inbox';

export const dynamic='force-dynamic';
const gmail='connector_2128aebfecb84f64a069897515042a44';

function value(result:Extract<ConnectorResult,{status:'success'}>):unknown{
  if(result.result.structuredContent!==undefined)return result.result.structuredContent;
  const text=result.result.content.find(item=>item.type==='text'&&typeof item.text==='string')?.text;
  if(typeof text!=='string')return null;
  try{return JSON.parse(text);}catch{return null;}
}
function failureStatus(result:Exclude<ConnectorResult,{status:'success'}>,returnTo:string){
  const status=result.status==='reauthentication_required'?401:result.status==='rate_limited'?429:503;
  return response({status:result.status,error:result.status==='reauthentication_required'?'Connect your Gmail account to read application messages.':result.status==='connector_access_disabled'||result.status==='tool_not_allowed'?'Gmail access is unavailable for this CyberApply workspace.':'The mailbox could not be checked right now. Try Refresh later.',...(result.status==='reauthentication_required'?{connectHref:`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`}:{})},status);
}

export async function GET(request:Request){
  try{
    const user=await identity(request);
    const saved=await load(user);
    const connectors=connectorsForRequest();
    const profileResult=await connectors.invoke(gmail,'get_profile',{});
    if(profileResult.status!=='success')return failureStatus(profileResult,'/workspace?view=inbox');
    const profile=value(profileResult);
    const mailbox=profile&&typeof profile==='object'&&'email'in profile&&typeof profile.email==='string'?profile.email:'';
    if(!mailbox)return response({error:'The connected Gmail account did not provide an email address.'},503);
    if(mailbox.toLowerCase()!==user.email.toLowerCase())return response({error:`Connected Gmail is ${mailbox}. Sign into Gmail with ${user.email} to see that account's application messages. No messages were read.`,status:'mailbox_mismatch',mailbox,items:[]},403);
    const applications=saved.state.applications||[];
    const query=inboxQuery(saved.state.jobs,applications);
    if(!query)return response({mailbox,items:[],checkedAt:new Date().toISOString(),scope:'No Apply requests with a matching employer are saved yet.'});
    const searchResult=await connectors.invoke(gmail,'search_emails',{query,max_results:75});
    if(searchResult.status!=='success')return failureStatus(searchResult,'/workspace?view=inbox');
    const raw=value(searchResult);
    const emails=raw&&typeof raw==='object'&&'emails'in raw&&Array.isArray(raw.emails)?raw.emails as MailRow[]:null;
    if(!emails)return response({error:'Gmail returned an unexpected response. No messages were displayed.'},502);
    const links=await listCareer<{messageId:string;applicationId:string|null}>(user,'inboxLinks',{limit:100});const items=matchingInboxMessages(emails,saved.state.jobs,applications).map(message=>{const link=links.find(r=>r.data.messageId===message.id),app=link?.data.applicationId?applications.find(a=>a.id===link.data.applicationId):undefined,job=app?saved.state.jobs.find(j=>j.id===app.jobId):undefined;return{...message,applicationId:link?app?.id||null:applications.find(a=>a.jobId===message.jobId)?.id,manualLink:!!link,...(job?{jobId:job.id,jobTitle:job.title,company:job.company}:{})};});return response({mailbox,items,applications:applications.map(a=>({id:a.id,title:saved.state.jobs.find(j=>j.id===a.jobId)?.title||'Vacancy',company:saved.state.jobs.find(j=>j.id===a.jobId)?.company||''})),checkedAt:new Date().toISOString(),scope:'Recent Inbox messages matching jobs in your Applications list. Other mail is hidden; only the first 75 search results are checked.'});
  }catch(error){return failure(error);}
}
