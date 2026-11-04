import { z } from 'zod';
import type { Job } from './cyber-domain';

export const boardSchema = z.object({ provider:z.enum(['greenhouse','lever']), board:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/), region:z.enum(['global','eu']).default('global'), company:z.string().trim().min(1).max(100) }).strict();
export const MAX_EMPLOYER_BOARDS=10;
export const filterDefaults={cybersecurityOnly:true,payFloor:0,currency:'USD',sponsorshipOnly:false,companySize:'',postedWithin:'any' as const,employmentType:'',industry:'',workMode:'any' as const,sort:'fit' as const};
export const searchSchema = z.object({ boards:z.array(boardSchema).min(1).max(MAX_EMPLOYER_BOARDS), keyword:z.string().trim().max(100), location:z.string().trim().max(100), remoteOnly:z.boolean(),cybersecurityOnly:z.boolean().default(true),payFloor:z.number().finite().min(0).max(1000000000).default(0),currency:z.string().regex(/^[A-Z]{3}$/).default('USD'),sponsorshipOnly:z.boolean().default(false),companySize:z.string().max(100).default(''),postedWithin:z.enum(['3','7','30','any']).default('any'),employmentType:z.string().max(100).default(''),industry:z.string().max(100).default(''),workMode:z.enum(['any','Remote','Hybrid','On-site']).default('any'),sort:z.enum(['fit','date','relevance']).default('fit') }).strict().superRefine((value,ctx)=>{
 const keys=value.boards.map(boardKey);
 if(new Set(keys).size!==keys.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Choose each employer board only once.'});
 if(value.boards.some(b=>b.provider==='greenhouse'&&b.region==='eu'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Greenhouse uses the global board endpoint.'});
});
export type EmployerBoard=z.infer<typeof boardSchema>;
export type JobSearch=z.infer<typeof searchSchema>;
export type JobSource={provider:'greenhouse'|'lever';board:string;region:'global'|'eu';externalId:string;boardUrl:string;checkedAt:string;availability:'open'|'closed';postedAt?:string;descriptionTruncated:boolean};
export type BoardReport={key:string;company:string;provider:EmployerBoard['provider'];status:'ok'|'error';fetched:number;matching:number;complete:boolean;message?:string};
export type DiscoveryReport={at:string;boards:BoardReport[];added:number;updated:number;closed:number;omitted:number;message:string};
export const recommendedBoards:EmployerBoard[]=[
 {provider:'greenhouse',board:'huntress',region:'global',company:'Huntress'},
 {provider:'greenhouse',board:'recordedfuture',region:'global',company:'Recorded Future'},
 {provider:'lever',board:'safe',region:'global',company:'Safe Security'},
 {provider:'greenhouse',board:'guidepointsecurity',region:'global',company:'GuidePoint Security'},
 {provider:'greenhouse',board:'knowbe4',region:'global',company:'KnowBe4'},
 {provider:'greenhouse',board:'abnormalsecurity',region:'global',company:'Abnormal AI'},
 {provider:'greenhouse',board:'wizinc',region:'global',company:'Wiz'},
 {provider:'greenhouse',board:'chainguard',region:'global',company:'Chainguard'},
];
export const defaultSearch:JobSearch={boards:recommendedBoards,keyword:'',location:'',remoteOnly:false,...filterDefaults};
export function addRecommendedSources(search:JobSearch):JobSearch{
 const keys=new Set(search.boards.map(boardKey));
 return {...search,boards:[...search.boards,...recommendedBoards.filter(board=>!keys.has(boardKey(board)))].slice(0,MAX_EMPLOYER_BOARDS)};
}
export function boardKey(board:Pick<EmployerBoard,'provider'|'board'|'region'>){return `${board.provider}:${board.region}:${board.board}`;}
export function boardUrl(board:EmployerBoard){return board.provider==='greenhouse'?`https://job-boards.greenhouse.io/${board.board}`:`https://jobs.${board.region==='eu'?'eu.':''}lever.co/${board.board}`;}
export function boardFromUrl(value:string,company:string):EmployerBoard {
 const url=new URL(value),parts=url.pathname.split('/').filter(Boolean);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||parts.length!==1)throw Error('Use the employer’s board URL, without a job ID or query.');
 const host=url.hostname.toLowerCase();
 const provider=['boards.greenhouse.io','job-boards.greenhouse.io'].includes(host)?'greenhouse':['jobs.lever.co','jobs.eu.lever.co'].includes(host)?'lever':null;
 if(!provider)throw Error('Use a Greenhouse or Lever employer board URL.');
 return boardSchema.parse({provider,board:parts[0],region:host==='jobs.eu.lever.co'?'eu':'global',company});
}
export function broadCybersecurityQuery(keyword:string){return /^(?:cyber\s*security|information\s*security|infosec)(?:\s+(?:jobs?|roles?|careers?))?$/.test(keyword.toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim());}
export function matchesSearch(job:Pick<Job,'title'|'location'|'workMode'|'department'>&Partial<Job>,search:Pick<JobSearch,'keyword'|'location'|'remoteOnly'>&Partial<JobSearch>,at=Date.now()){
 const keyword=search.keyword.trim().toLowerCase();
 const roleMatch=!keyword||(broadCybersecurityQuery(keyword)?cybersecurityRole(job.title,job.department):job.title.toLowerCase().includes(keyword));
 if(!roleMatch||search.location&&!job.location.toLowerCase().includes(search.location.toLowerCase())||search.remoteOnly&&job.workMode!=='Remote')return false;
 if(search.cybersecurityOnly!==false&&job.source&&!cybersecurityRole(job.title,job.department))return false;
 if(search.workMode&&search.workMode!=='any'&&job.workMode!==search.workMode)return false;
 if(search.sponsorshipOnly&&job.sponsorshipOffered!==true)return false;
 if(search.companySize&&job.companySize!==search.companySize||search.industry&&!job.industry?.toLowerCase().includes(search.industry.toLowerCase())||search.employmentType&&job.employmentType?.toLowerCase()!==search.employmentType.toLowerCase())return false;
 if(search.postedWithin&&search.postedWithin!=='any'){const posted=Date.parse(job.postedAt||job.source?.postedAt||'');if(!Number.isFinite(posted)||posted>at||at-posted>Number(search.postedWithin)*86400000)return false;}
 if(search.payFloor){if(!job.salary||job.salary.currency!==search.currency)return false;const minimum=job.salary.min??job.salary.max;if(minimum===undefined)return false;const annual=minimum*(job.salary.period==='month'?12:job.salary.period==='hour'?2080:1);if(annual<search.payFloor)return false;}
 return true;
}
export function cybersecurityRole(title:string,department=''){return /\b(security|cyber\w*|soc|appsec|devsecops|grc|threat|vulnerabilit\w*|penetration|pentest\w*|malware|incident response|digital forensics|iam|identity and access|red team|blue team|detection engineer|trust and safety)\b/i.test(`${title} ${department}`);}
export function sourceLabel(job:Job){return job.source?`${job.source.provider==='greenhouse'?'Greenhouse':'Lever'} · checked ${new Date(job.source.checkedAt).toLocaleDateString()}`:'Listing supplied · not independently verified';}
