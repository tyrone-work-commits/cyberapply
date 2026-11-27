import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {privateJson,reserveCareer} from '@/lib/career-store';
import {geocoderConfig,addressSuggestions} from '@/lib/geocoder';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);return response({provider:geocoderConfig(env as unknown as Record<string,unknown>).provider});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await identity(request);await load(user);const input=z.object({query:z.string().trim().min(3).max(500),consent:z.literal('SHARE_ADDRESS_QUERY_WITH_CONFIGURED_GEOCODER')}).strict().parse(await privateJson(request)),config=geocoderConfig(env as unknown as Record<string,unknown>);if(config.provider==='none')return response({items:[],provider:'none',message:'Address suggestions are disabled. Enter your address manually.'});await reserveCareer(user,'addressLookups',10,new Date().toISOString().slice(0,10));return response({items:await addressSuggestions(config,input.query),provider:config.provider,reviewRequired:true});}catch(e){return failure(e);}}
