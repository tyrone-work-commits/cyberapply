import type {ApplicationRequest,Job,State} from './cyber-domain';

export type MailPart={mime_type?:string;filename?:string;headers?:{name:string;value:string}[];body?:{content?:string|null};parts?:MailPart[]|null};
export type ReceiptMail={id?:string;internal_date?:string;label_ids?:string[];payload?:MailPart};
export type VerifiedReceipt={requestId:string;messageId:string;mailbox:string;sender:string;receivedAt:string;url:string;excerpt:string;policy:'gmail-receipt-v1'};
const providers=['greenhouse.io','greenhouse-mail.io','lever.co','hire.lever.co','ashbyhq.com','smartrecruiters.com'];
const words=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const phrase=(text:string,value:string)=>value.length>=4&&(` ${words(text)} `).includes(` ${words(value)} `);
const emailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
function addresses(s:string){return [...new Set((s.match(emailPattern)||[]).map(v=>v.toLowerCase()))];}
function headers(mail:ReceiptMail,name:string){return (mail.payload?.headers||[]).filter(h=>h.name.toLowerCase()===name).map(h=>h.value);}
function oneHeader(mail:ReceiptMail,name:string){const values=headers(mail,name);return values.length===1?values[0]:'';}
function employerHosts(job:Job){return [job.url,job.applyUrl].flatMap(value=>{try{const u=new URL(value||'');return u.protocol==='https:'&&!u.username&&!u.password?[u.hostname.replace(/^(www|jobs|careers|apply)\./,'').toLowerCase()]:[];}catch{return [];}});}
function sameDomain(host:string,domain:string){return host===domain||host.endsWith('.'+domain);}
function submittedEmail(request:ApplicationRequest){
 const rows=Array.isArray(request.report?.answers)?request.report.answers as Record<string,unknown>[]:[];
 const values=rows.filter(row=>typeof row.question==='string'&&/^(?:(?:personal|primary) )?e ?mail(?: address)?\s*\*?$/i.test(row.question.trim())).flatMap(row=>typeof row.value==='string'?addresses(row.value):[]);
 const unique=[...new Set(values)];
 if(unique.length)return unique.length===1?unique[0]:'';
 const fallback=addresses(request.candidate.email);return fallback.length===1?fallback[0]:'';
}
export function pendingReceiptRequests(state:State,now=Date.now()){
 return (state.applications||[]).filter(r=>r.status==='uncertain'||r.status==='processing'&&!!r.claim&&Date.parse(r.claim.expiresAt)<=now).slice(0,25);
}
export function receiptQuery(state:State,now=Date.now()){
 const requests=pendingReceiptRequests(state,now),terms=new Set<string>();
 for(const request of requests){const job=state.jobs.find(j=>j.id===request.jobId);if(!job)continue;const company=words(job.company).slice(0,80);if(company.length>=4)terms.add('"'+company+'"');for(const domain of employerHosts(job))if(/^[a-z0-9.-]+$/.test(domain))terms.add('from:'+domain);}
 if(!terms.size)return '';
 const earliest=Math.min(...requests.map(r=>Date.parse(r.claim?.at||r.at)).filter(Number.isFinite));
 const after=Math.floor(Math.max(earliest-1000,now-90*86400000)/1000);
 return `in:anywhere -in:spam -in:trash -in:sent -in:drafts after:${after} {${[...terms].slice(0,30).join(' ')}}`;
}
function content(mail:ReceiptMail){
 const plain:string[]=[],html:string[]=[];let count=0,total=0;
 const visit=(part:MailPart,depth:number)=>{if(++count>30||depth>6||part.filename)return;const text=part.body?.content;if(typeof text==='string'&&text.length+total<=60000){total+=text.length;if(part.mime_type==='text/plain')plain.push(text);if(part.mime_type==='text/html')html.push(text);}for(const child of part.parts||[])visit(child,depth+1);};
 if(mail.payload)visit(mail.payload,0);
 return plain.length?plain.join('\n'):html.join('\n').replace(/<(script|style|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:p|div|li)>|<br\s*\/?>/gi,'\n\n').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,' ');
}
function authenticSender(mail:ReceiptMail,sender:string){
 // Use the first receiver-authored result, never a body claim or a forwarded
 // ARC result. Missing/ambiguous authentication leaves the outcome unresolved.
 const result=headers(mail,'authentication-results').find(h=>/^\s*mx\.google\.com\s*;/i.test(h));
 return !!result&&new RegExp('(?:^|;)\\s*dmarc=pass\\b[^;]*\\bheader\\.from='+sender.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:\\s|;|$)','i').test(result);
}
const positive=/\b(?:thank you for applying|we(?:'|’)ve received your application|we have received your application|your application (?:has been |was )?(?:successfully )?(?:submitted|received)|for submitting your application)\b/i;
const negative=/\b(?:not(?:\s+\w+){0,3}\s+(?:received|submitted)|haven.t received|application (?:is )?incomplete|complete your application|finish your application|submission failed|could not submit|unable to submit|draft application|forwarded message|original message)\b/i;
export function verifyEmployerReceipts(messages:ReceiptMail[],state:State,mailbox:string,now=Date.now()):VerifiedReceipt[]{
 const pending=pendingReceiptRequests(state,now),verified:VerifiedReceipt[]=[],used=new Set<string>();
 for(const mail of messages.slice(0,10)){
  if(!mail.id||!/^\w{10,64}$/.test(mail.id)||used.has(mail.id)||!/^\d{12,16}$/.test(mail.internal_date||''))continue;
  if((mail.label_ids||[]).some(label=>['SENT','DRAFT','TRASH','SPAM'].includes(label)))continue;
  const senders=addresses(oneHeader(mail,'from')),recipients=addresses(oneHeader(mail,'to'));
  if(senders.length!==1||!recipients.includes(mailbox.toLowerCase()))continue;
  const sender=senders[0].split('@')[1];if(!authenticSender(mail,sender))continue;
  const subject=oneHeader(mail,'subject'),body=content(mail),text=subject+'\n'+body;
  const receiptBlocks=body.split(/\n\s*\n/).filter(block=>block.length<=2000&&positive.test(block));
  if(/^(?:re|fw|fwd)\s*:/i.test(subject)||/^\s*>/m.test(body)||!receiptBlocks.length||negative.test(text))continue;
  const received=Number(mail.internal_date);if(!Number.isFinite(received)||received>now+120000)continue;
  const candidates=pending.filter(request=>{
   const job=state.jobs.find(j=>j.id===request.jobId);if(!job||submittedEmail(request)!==mailbox.toLowerCase())return false;
   const attempt=Date.parse(request.claim?.at||request.at);if(!Number.isFinite(attempt)||received<attempt||received>attempt+14*86400000)return false;
   const own=employerHosts(job).filter(domain=>!providers.some(p=>sameDomain(domain,p)));
   const trusted=own.some(domain=>sameDomain(sender,domain))||providers.some(domain=>sameDomain(sender,domain));
   return trusted&&receiptBlocks.some(block=>phrase(block,job.title))&&phrase(text,job.company);
  });
  if(candidates.length!==1||verified.some(v=>v.requestId===candidates[0].id))continue;
  const matchedJob=state.jobs.find(j=>j.id===candidates[0].jobId)!;
  const excerpt=receiptBlocks.find(block=>phrase(block,matchedJob.title))!.replace(/\s+/g,' ').trim().slice(0,800);
  verified.push({requestId:candidates[0].id,messageId:mail.id,mailbox:mailbox.toLowerCase(),sender,receivedAt:new Date(received).toISOString(),url:`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox.toLowerCase())}#all/${mail.id}`,excerpt,policy:'gmail-receipt-v1'});used.add(mail.id);
 }
 return verified;
}
export function applyVerifiedReceipts(state:State,matches:VerifiedReceipt[],at=new Date().toISOString()){
 const applied:string[]=[];
 for(const receipt of matches){const item=pendingReceiptRequests(state,Date.parse(at)).find(r=>r.id===receipt.requestId);if(!item)continue;
  // Preserve the original browser result as well as immutable revision history.
  item.receiptVerification={...receipt,verifiedAt:at,previousResult:item.result};
  item.status='applied';item.result={at,message:'Employer receipt verified from your connected Gmail.',receipt:'The employer acknowledged receipt of this application by email.',evidence:{url:receipt.url,text:receipt.excerpt}};
  applied.push(item.id);
 }
 return applied;
}
