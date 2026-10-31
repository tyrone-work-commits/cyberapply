import type { ApplicationRequest, Job } from './cyber-domain';

export type InboxMessage = { id:string; subject:string; from:string; snippet:string; receivedAt:string; url:string; jobId:string; jobTitle:string; company:string; unread:boolean };
export type MailRow = {id?:unknown;subject?:unknown;from_?:unknown;snippet?:unknown;email_ts?:unknown;display_url?:unknown;labels?:unknown};

const intent=/\b(applicat(?:ion|ions)|applied|applying|interview|assessment|screening|recruit(?:er|ment|ing)|hiring|candidate|offer|next steps?|resume|résumé|cv|received|thank you|follow.up)\b/i;
const alert=/\b(job alerts?|jobs? you may like|recommended jobs?|new jobs? for you|weekly jobs?|daily jobs?)\b/i;
const sharedHosts=new Set(['greenhouse.io','lever.co','workday.com','myworkdayjobs.com','ashbyhq.com','smartrecruiters.com']);

function words(value:string){return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function companyPhrase(value:string){return words(value).replace(/\b(limited|ltd|inc|llc|plc|corp|corporation)\b/g,'').replace(/\s+/g,' ').trim();}
function host(url:string){try{const value=new URL(url).hostname.toLowerCase();return value.replace(/^(www|careers|jobs|apply)\./,'');}catch{return '';}}
function employerHost(job:Job){for(const url of [job.applyUrl,job.url]){if(!url)continue;const value=host(url);if(value&&!([...sharedHosts].some(shared=>value===shared||value.endsWith(`.${shared}`))))return value;}return '';}
function senderHost(value:string){const match=value.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);return match?.[1]?.toLowerCase()||'';}
function safeMailUrl(value:unknown){if(typeof value!=='string')return '';try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='mail.google.com'?url.href:'';}catch{return '';}}
function mailTime(value:unknown){
  if(typeof value!=='string'&&typeof value!=='number')return '';
  const parsed=typeof value==='string'&&/^\d{12,}$/.test(value)?Number(value):value;
  const date=new Date(parsed);
  return Number.isNaN(date.getTime())?'':date.toISOString();
}

export function inboxQuery(jobs:Job[],applications:ApplicationRequest[]){
  const terms=new Set<string>();
  for(const request of applications.slice(0,20)){
    const job=jobs.find(item=>item.id===request.jobId);if(!job)continue;
    const company=companyPhrase(job.company).slice(0,70);
    if(company.length>=4)terms.add(`"${company}"`);
    const domain=employerHost(job);if(domain)terms.add(`from:${domain}`);
    if(company.length<4&&!domain){const role=words(job.title).slice(0,70);if(role.length>=8)terms.add(`"${role}"`);}
    if(terms.size>=18)break;
  }
  return terms.size?`in:inbox -in:spam -in:trash {${[...terms].join(' ')}}`:'';
}

export function matchingInboxMessages(rows:MailRow[],jobs:Job[],applications:ApplicationRequest[]):InboxMessage[]{
  const matches:InboxMessage[]=[];
  const seen=new Set<string>();
  for(const row of rows){
    if(typeof row.id!=='string'||seen.has(row.id))continue;
    const subject=typeof row.subject==='string'?row.subject.slice(0,300):'';
    const from=typeof row.from_==='string'?row.from_.slice(0,300):'';
    const snippet=typeof row.snippet==='string'?row.snippet.slice(0,500):'';
    const content=`${subject} ${snippet}`;
    if(alert.test(subject)||!intent.test(content))continue;
    const normalized=words(`${subject} ${from}`);
    const sender=senderHost(from);
    for(const request of applications){
      const job=jobs.find(item=>item.id===request.jobId);if(!job)continue;
      const company=companyPhrase(job.company);
      const role=words(job.title);
      const domain=employerHost(job);
      const companyMatch=company.length>=4&&normalized.includes(company);
      const roleMatch=role.length>=8&&normalized.includes(role);
      const domainMatch=!!domain&&(sender===domain||sender.endsWith(`.${domain}`));
      const companyDomain=company.replaceAll(' ','');
      const senderLooksLikeCompany=companyDomain.length>=6&&sender.includes(companyDomain);
      const atsSender=[...sharedHosts].some(shared=>sender===shared||sender.endsWith(`.${shared}`));
      if(!domainMatch&&!senderLooksLikeCompany&&!(atsSender&&(companyMatch||roleMatch)))continue;
      const url=safeMailUrl(row.display_url);
      const time=mailTime(row.email_ts);
      const labels=Array.isArray(row.labels)?row.labels:[];
      matches.push({id:row.id,subject:subject||'(No subject)',from,snippet,receivedAt:time,url,jobId:job.id,jobTitle:job.title,company:job.company,unread:labels.includes('UNREAD')});
      seen.add(row.id);
      break;
    }
    if(matches.length>=30)break;
  }
  return matches;
}
