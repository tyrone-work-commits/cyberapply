import { DomainError, liveState, record, safeJobUrl, type Job, type State, type Activity } from './cyber-domain';
import { boardKey, boardUrl, cybersecurityRole, matchesSearch, searchSchema, type EmployerBoard, type JobSearch, type BoardReport, type DiscoveryReport } from './job-catalog';

const MAX_BYTES=8_000_000, MAX_DESCRIPTION=6500, MAX_NEW=24;
const skillWords=['SIEM','Splunk','Python','SQL','Linux','AWS','Azure','GCP','Incident response','Threat hunting','Threat intelligence','Malware','Penetration testing','Vulnerability management','IAM','SOC 2','ISO 27001','NIST','Kubernetes','Docker','Terraform','EDR','XDR','SOAR','MITRE ATT&CK','AppSec'];
function plain(value:unknown){
 let text=typeof value==='string'?value:'';
 const decode=(s:string)=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,key:string)=>{
  const names:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  if(key[0]!=='#')return names[key.toLowerCase()]||'';
  const point=parseInt(key.slice(key[1]?.toLowerCase()==='x'?2:1),key[1]?.toLowerCase()==='x'?16:10);
  return Number.isFinite(point)&&point>0&&point<=0x10ffff?String.fromCodePoint(point):'';
 });
 text=decode(decode(text));
 return decode(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\s*li\b[^>]*>/gi,'\n• ').replace(/<\/?(?:p|div|h[1-6]|ul|ol|br)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
}
function validUrl(value:unknown){try{return typeof value==='string'?safeJobUrl(value):'';}catch{return '';}}
function mode(value:string){return /\bhybrid\b/i.test(value)?'Hybrid':/\bremote\b/i.test(value)?'Remote':/\bon.?site\b/i.test(value)?'On-site':'Unspecified';}
function timestamp(value:unknown){const d=new Date(typeof value==='number'||typeof value==='string'?value:'');return Number.isNaN(d.valueOf())?undefined:d.toISOString();}
type Row=Record<string,any>;
export function normalizeJob(raw:Row,board:EmployerBoard,at:string):Job|null {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const externalId=String(raw.id??'');
 if(!externalId||externalId.length>100)return null;
 const greenhouse=board.provider==='greenhouse';
 const title=plain(greenhouse?raw.title:raw.text).slice(0,200),url=validUrl(greenhouse?raw.absolute_url:raw.hostedUrl);
 const department=plain(greenhouse?(Array.isArray(raw.departments)?raw.departments.map((d:Row)=>d?.name||'').join(' '):''):String(raw.categories?.team||'')).slice(0,500);
 const applyUrl=validUrl(greenhouse?raw.absolute_url:raw.applyUrl)||url;
 const rawDescription=greenhouse?plain(raw.content):[plain(raw.descriptionPlain||raw.description),...(Array.isArray(raw.lists)?raw.lists.slice(0,30).map((item:Row)=>`${plain(item.text)}\n${plain(item.content)}`):[]),plain(raw.additionalPlain||raw.additional)].filter(Boolean).join('\n\n');
 if(!title||!url||rawDescription.length<20)return null;
 const metadata=Array.isArray(raw.metadata)?raw.metadata:[];
 const extraLocations=metadata.filter((m:Row)=>/location/i.test(String(m.name))).flatMap((m:Row)=>Array.isArray(m.value)?m.value:typeof m.value==='string'?[m.value]:[]);
 const statedLocation=greenhouse?rawDescription.match(/(?:^|\n)\s*(?:Location|Workplace|Work arrangement)\s*:\s*([^\n]+)/i)?.[1]||'':'';
 const location=greenhouse?[...new Set([plain(raw.location?.name),...extraLocations.map(plain),statedLocation].filter(Boolean))].join(' · ').slice(0,500):[...new Set([plain(raw.categories?.location),...(Array.isArray(raw.categories?.allLocations)?raw.categories.allLocations.map(plain):[])].filter(Boolean))].join(' · ').slice(0,500);
 const workMode=mode(greenhouse?location:String(raw.workplaceType||location));
 const description=rawDescription.slice(0,MAX_DESCRIPTION);
 const skills=skillWords.filter(skill=>new RegExp(`(^|[^a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9]|$)`,'i').test(rawDescription));
 return {id:`${boardKey(board)}:${externalId}`,title,company:greenhouse?plain(raw.company_name||board.company).slice(0,200):board.company,department,location,workMode,url,applyUrl,description,skills,sample:false,saved:false,disposition:'open',createdAt:at,source:{provider:board.provider,board:board.board,region:board.region,externalId,boardUrl:boardUrl(board),checkedAt:at,availability:'open',postedAt:timestamp(greenhouse?raw.first_published:raw.createdAt),descriptionTruncated:rawDescription.length>MAX_DESCRIPTION}};
}
async function jsonFeed(url:string,fetcher:typeof fetch,signal:AbortSignal){
 // Workers supports manual/follow. Reject redirects explicitly to keep requests on the fixed API host.
 const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal});
 if(!response.ok){await response.body?.cancel();throw new Error(response.status===429?'The employer feed is rate limited. Try again later.':`Employer feed returned HTTP ${response.status}.`);}
 if(!/json/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw new Error('Employer feed did not return JSON.');}
 const reader=response.body?.getReader();if(!reader)throw new Error('Employer feed was empty.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw new Error('Employer board is too large for this search. Choose a smaller board.');chunks.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export type BoardResult={board:EmployerBoard;jobs:Job[];seen:string[];report:BoardReport};
export async function fetchBoard(board:EmployerBoard,search:JobSearch,at:string,fetcher:typeof fetch=fetch):Promise<BoardResult>{
 const report:BoardReport={key:boardKey(board),company:board.company,provider:board.provider,status:'ok',fetched:0,matching:0,complete:true};
 try{
  let rows:Row[]=[];
  const signal=AbortSignal.timeout(15000);
  if(board.provider==='greenhouse'){
   const data=await jsonFeed(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.board)}/jobs?content=true`,fetcher,signal);
   if(!data||!Array.isArray(data.jobs))throw Error('Employer feed has an unexpected format.');
   rows=data.jobs;
  }else{
   // Pagination is bounded. Incomplete scans never close unseen saved vacancies.
   for(let skip=0;skip<1000;skip+=250){
    const data=await jsonFeed(`https://api.${board.region==='eu'?'eu.':''}lever.co/v0/postings/${encodeURIComponent(board.board)}?mode=json&skip=${skip}&limit=250`,fetcher,signal);
    if(!Array.isArray(data))throw Error('Employer feed has an unexpected format.');
    rows.push(...data);if(data.length<250)break;if(skip===750)report.complete=false;
   }
  }
  if(rows.length>3000){rows=rows.slice(0,3000);report.complete=false;}
  report.fetched=rows.length;
  const seen=rows.filter(row=>row&&row.id!==undefined).map(row=>String(row.id));
  const jobs=rows.map(row=>{const job=normalizeJob(row,board,at);return job&&cybersecurityRole(job.title,job.department)&&matchesSearch(job,search)?job:null;}).filter((job):job is Job=>job!==null);
  report.matching=jobs.length;
  return {board,jobs:[...new Map(jobs.map(job=>[job.id,job])).values()],seen,report};
 }catch(error){console.warn('Employer feed unavailable',boardKey(board),error instanceof Error?`${error.name}: ${error.message.slice(0,250)}`:'Unknown network error');return {board,jobs:[],seen:[],report:{...report,status:'error',complete:false,message:error instanceof Error&&error.name==='TimeoutError'?'Employer feed timed out. Try again.':error instanceof Error&&/^Employer|^The employer/.test(error.message)?error.message:'Could not read this employer feed. Check the board URL or try again later.'}};}
}
export async function discover(settings:unknown,fetcher:typeof fetch=fetch,at=new Date().toISOString()){
 const parsed=searchSchema.safeParse(settings);if(!parsed.success)throw new DomainError('Choose one to ten valid employer boards and valid search filters.');
 // Keep the larger source list within the existing Worker memory/network budget.
 const results:BoardResult[]=new Array(parsed.data.boards.length);let next=0;
 await Promise.all(Array.from({length:Math.min(3,parsed.data.boards.length)},async()=>{
  while(next<parsed.data.boards.length){const index=next++;results[index]=await fetchBoard(parsed.data.boards[index],parsed.data,at,fetcher);}
 }));
 return {settings:parsed.data,results,at};
}
export function mergeDiscovery(before:State,search:JobSearch,results:BoardResult[],at:string,source:Activity['source']){
 const state=liveState(before);let added=0,updated=0,closed=0,omitted=0;
 const successful=results.filter(result=>result.report.status==='ok');
 for(const result of successful){
  for(const job of state.jobs){
   if(job.source&&boardKey(job.source)===boardKey(result.board)&&result.report.complete){const available=result.seen.includes(job.source.externalId);if(!available&&job.source.availability!=='closed')closed++;job.source={...job.source,checkedAt:at,availability:available?'open':'closed'};}
  }
 }
 // Round-robin employers so the first large board does not consume every slot.
 const candidates:Job[]=[];const max=Math.max(0,...successful.map(r=>r.jobs.length));for(let i=0;i<max;i++)for(const result of successful)if(result.jobs[i])candidates.push(result.jobs[i]);
 for(const job of candidates){
  const existing=state.jobs.find(item=>item.id===job.id||item.url===job.url||item.applyUrl===job.applyUrl);
  if(existing){Object.assign(existing,{...job,id:existing.id,saved:existing.saved,disposition:existing.disposition,previousDisposition:existing.previousDisposition,decidedAt:existing.decidedAt,createdAt:existing.createdAt});updated++;continue;}
  if(added>=MAX_NEW||state.jobs.length>=200){omitted++;continue;}
  const length=JSON.stringify(state).length+JSON.stringify(job).length;
  if(length>650000){omitted++;continue;}
  state.jobs.push(job);added++;
 }
 const failed=results.filter(result=>result.report.status==='error').length;
 const message=`${added} new vacancies added; ${updated} refreshed.${closed?` ${closed} no longer listed.`:''}${omitted?` ${omitted} matching vacancies exceed this import’s limit; narrow your filters.`:''}${failed?` ${failed} employer feed${failed===1?'':'s'} could not be read; saved work was retained.`:''}${!added&&!updated&&!failed?' No cybersecurity roles matched these filters.':''}`;
 const report:DiscoveryReport={at,boards:results.map(r=>r.report),added,updated,closed,omitted,message};
 state.discovery={settings:search,lastSearch:report};record(state,'discover_jobs',message,source,at);
 return {state,message,report};
}
