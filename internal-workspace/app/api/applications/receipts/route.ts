import {z} from 'zod';
import {identity,load,response,failure,setReceiptChecking,claimReceiptCheck,reconcileReceiptMessages} from '@/lib/cyber-store';
import {DomainError} from '@/lib/cyber-domain';
import {connectorsForRequest,type ConnectorResult} from '@/lib/connectors';
import {pendingReceiptRequests,receiptQuery,type ReceiptMail} from '@/lib/employer-receipts';
export const dynamic='force-dynamic';
const gmail='connector_2128aebfecb84f64a069897515042a44';
const schema=z.object({action:z.enum(['enable','disable','check']),automatic:z.boolean().optional()}).strict();
function value(result:Extract<ConnectorResult,{status:'success'}>):unknown{
 if(result.result.structuredContent!==undefined)return result.result.structuredContent;
 const text=result.result.content.find(c=>c.type==='text')?.text;try{return typeof text==='string'?JSON.parse(text):null;}catch{return null;}
}
function connectorFailure(result:Exclude<ConnectorResult,{status:'success'}>){
 const reconnect=result.status==='reauthentication_required';
 return response({status:result.status,error:reconnect?'Connect the Gmail account matching your CyberApply sign-in to check employer receipts.':'Receipt checking is unavailable right now. Your application outcomes are unchanged.',retryAfterMs:Math.max(120000,result.retryAfterMs||0),...(reconnect?{connectHref:'/signin-with-chatgpt?return_to=%2Fworkspace%3Fview%3Dapplications'}:{})},reconnect?401:result.status==='rate_limited'?429:503);
}
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new DomainError('Receipt checks require a same-origin request.',403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('Send JSON.',415);
 if(Number(request.headers.get('content-length')||0)>1000)throw new DomainError('Request too large.',413);
 const raw=await request.text();if(raw.length>1000)throw new DomainError('Request too large.',413);
 let body:z.infer<typeof schema>;try{body=schema.parse(JSON.parse(raw));}catch{throw new DomainError('Choose a receipt-check action.');}
 const user=await identity(request);
 let saved=await load(user);
 if(body.action==='enable'||body.action==='disable')saved=await setReceiptChecking(user,body.action==='enable');
 if(body.action==='disable'||body.automatic&&!saved.state.receiptChecksEnabled)return response({status:'disabled',enabled:false,confirmed:[],changed:false});
 if(!pendingReceiptRequests(saved.state).length)return response({status:'idle',enabled:!!saved.state.receiptChecksEnabled,confirmed:[],changed:false,checkedAt:new Date().toISOString(),message:'No applications are awaiting confirmation.'});
 const wait=await claimReceiptCheck(user);if(wait){const r=response({status:'cooldown',retryAfterMs:wait,enabled:!!saved.state.receiptChecksEnabled,changed:false,confirmed:[],message:'The next receipt check will run shortly.'},429);r.headers.set('Retry-After',String(Math.ceil(wait/1000)));return r;}
 const connectors=connectorsForRequest(),profileResult=await connectors.invoke(gmail,'get_profile',{});
 if(profileResult.status!=='success')return connectorFailure(profileResult);
 const profile=value(profileResult) as {email?:unknown}|null;
 const mailbox=typeof profile?.email==='string'?profile.email:'';
 if(!mailbox||mailbox.toLowerCase()!==user.email.toLowerCase())return response({status:'mailbox_mismatch',error:'Connect the Gmail account matching your CyberApply sign-in. No messages were read.',retryAfterMs:120000},403);
 const search=await connectors.invoke(gmail,'search_emails',{query:receiptQuery(saved.state),max_results:40});
 if(search.status!=='success')return connectorFailure(search);
 const result=value(search) as {emails?:{id?:unknown;subject?:unknown;snippet?:unknown;has_attachment?:unknown;inline_images?:unknown[]}[];next_page_token?:unknown}|null;
 if(!Array.isArray(result?.emails))throw new DomainError('Gmail returned an unexpected search response. Outcomes are unchanged.',502);
 const ids=[...new Set(result.emails.filter(row=>typeof row.id==='string'&&/^\w{10,64}$/.test(row.id)&&row.has_attachment!==true&&!(row.inline_images?.length)&&/appl(?:ication|ying)|received|thank you/i.test(String(row.subject||'')+' '+String(row.snippet||''))).map(row=>String(row.id)))].slice(0,10);
 const messages:ReceiptMail[]=[];let incomplete=false;
 for(let i=0;i<ids.length;i+=3){
  const batch=await Promise.all(ids.slice(i,i+3).map(message_id=>connectors.invoke(gmail,'read_email',{message_id,format:'full'})));
  for(const entry of batch){if(entry.status!=='success'){incomplete=true;continue;}const data=value(entry);if(data&&typeof data==='object'&&JSON.stringify(data).length<=300000)messages.push(data as ReceiptMail);else incomplete=true;}
 }
 const reconciled=await reconcileReceiptMessages(user,mailbox,messages);
 const pending=pendingReceiptRequests(reconciled.state).length;
 return response({status:incomplete?'partial':'checked',enabled:!!reconciled.state.receiptChecksEnabled,changed:reconciled.confirmed.length>0,confirmed:reconciled.confirmed,awaiting:pending,checkedAt:new Date().toISOString(),retryAfterMs:120000,message:reconciled.confirmed.length?`${reconciled.confirmed.length} employer receipt${reconciled.confirmed.length===1?'':'s'} verified. Matching applications now show Applied.`:'No new verified employer receipts found. These applications remain protected from duplicate submissions.',limited:!!result.next_page_token||ids.length===10||incomplete});
}catch(error){return failure(error);}}
