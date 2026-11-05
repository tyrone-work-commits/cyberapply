import {response,failure} from '@/lib/cyber-store';
import {listCareer,remainingCareer} from '@/lib/career-store';
import {extensionAuth,extensionCors,extensionPreflight,readExtensionJson,importExtensionJob,extensionScanLimit} from '@/lib/extension-store';
import {extensionImportSchema} from '@/lib/extension-protocol';
export const dynamic='force-dynamic';
export async function OPTIONS(request:Request){try{return await extensionPreflight(request);}catch(e){return failure(e);}}
export async function GET(request:Request){let id='';try{const auth=await extensionAuth(request,'recent_jobs');id=auth.extensionId;const rows=await listCareer<{job:{title:string;company:string;url:string};result?:{url:string}}>(auth.user,'extensionImports',{limit:10});return Response.json({items:rows.map(r=>({title:r.data.job.title,company:r.data.job.company,url:r.data.job.url,reportUrl:r.data.result?.url})),remaining:await remainingCareer(auth.user,'scans',extensionScanLimit())},{headers:extensionCors(id)});}catch(e){const res=failure(e);if(id)Object.entries(extensionCors(id)).forEach(([k,v])=>res.headers.set(k,v));return res;}}
export async function POST(request:Request){let id='';try{const raw=extensionImportSchema.parse(await readExtensionJson(request)),auth=await extensionAuth(request,raw.mode==='scan'?'scan_jobs':'save_jobs');id=auth.extensionId;return Response.json(await importExtensionJob(auth.user,raw),{headers:extensionCors(id)});}catch(e){const res=failure(e);if(id)Object.entries(extensionCors(id)).forEach(([k,v])=>res.headers.set(k,v));return res;}}
