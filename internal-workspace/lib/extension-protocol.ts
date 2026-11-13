import {z} from 'zod';
export const extensionOrigin='https://cyberapply-internal.covenda-1182.chatgpt.site';
export const extensionIdPattern=/^[a-p]{32}$/;
export const extensionScopes=['save_jobs','scan_jobs','recent_jobs'] as const;
export function canonicalExtensionUrl(value:string){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)throw new Error('Use a public HTTPS job page.');
 const host=u.hostname.toLowerCase();const out=new URL(u.origin+u.pathname);
 if((host==='linkedin.com'||host==='www.linkedin.com')&&/^\/jobs\/(view|search)(\/|$)/.test(u.pathname)){const id=u.searchParams.get('currentJobId');if(id&&/^\d{1,30}$/.test(id))out.searchParams.set('currentJobId',id);}
 else if(/^(?:[a-z]{2}\.)?indeed\.com$/.test(host)&&/^\/(?:viewjob|rc\/clk|jobs)(\/|$)/.test(u.pathname)){const id=u.searchParams.get('jk');if(!id||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw new Error('Open a specific Indeed job.');out.searchParams.set('jk',id);}
 else if(/^(?:www\.)?glassdoor\.(?:com|co\.uk)$/.test(host)&&/^\/job-listing\//.test(u.pathname)){const id=u.searchParams.get('jl');if(id&&/^\d{1,30}$/.test(id))out.searchParams.set('jl',id);}
 else throw new Error('Open a LinkedIn Jobs, Indeed or Glassdoor job page.');
 return out.href;
}
export const extensionImportSchema=z.object({transferId:z.string().uuid(),mode:z.enum(['save','scan']),title:z.string().trim().min(1).max(200),company:z.string().trim().max(200),location:z.string().trim().max(500),description:z.string().trim().min(20).max(30000),url:z.string().max(2000).transform((s,ctx)=>{try{return canonicalExtensionUrl(s);}catch(e){ctx.addIssue({code:z.ZodIssueCode.custom,message:(e as Error).message});return z.NEVER;}})}).strict();
export type ExtensionImport=z.infer<typeof extensionImportSchema>;
export type ExtensionGrant={extensionId:string;hash:string;scopes:readonly string[];expiresAt:string;revoked:boolean};
export async function extensionHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function equalExtensionHash(a:string,b:string){if(a.length!==64||b.length!==64)return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export function extensionGrantAllows(g:ExtensionGrant,id:string,scope:string,now=Date.now()){return extensionIdPattern.test(id)&&g.extensionId===id&&!g.revoked&&Date.parse(g.expiresAt)>now&&g.scopes.includes(scope);}
