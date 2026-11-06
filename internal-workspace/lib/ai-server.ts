import {env} from 'cloudflare:workers';
import {aiConfig,generateText,generateJson,type AiRequest} from './ai-service';
import type {Identity} from './cyber-store';
import type {z} from 'zod';

function config(){return aiConfig(env as unknown as Record<string,unknown>);}
async function reserve(owner:string,limit:number){
 if(!env.DB)throw new Error('Storage unavailable');
 const row=await env.DB.prepare('INSERT INTO cyber_ai_usage (owner_id,day,count) VALUES (?,?,1) ON CONFLICT(owner_id,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(owner,new Date().toISOString().slice(0,10),limit).first();return !!row;
}
export async function aiStatus(user:Identity){const c=config();const row=await env.DB!.prepare('SELECT count FROM cyber_ai_usage WHERE owner_id=? AND day=?').bind(user.userId,new Date().toISOString().slice(0,10)).first<{count:number}>();return{enabled:c.provider!=='none'&&!!c.key&&!!c.model,provider:c.provider,remaining_today:Math.max(0,c.dailyLimit-(row?.count||0))};}
export async function writeText(user:Identity,input:AiRequest){return generateText(config(),input,limit=>reserve(user.userId,limit));}
export async function writeJson<T>(user:Identity,input:AiRequest,schema:z.ZodType<T>){return generateJson(config(),input,schema,limit=>reserve(user.userId,limit));}
