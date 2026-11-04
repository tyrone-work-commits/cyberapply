import {identity,response,failure} from '@/lib/cyber-store';
import {aiStatus} from '@/lib/ai-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{return response(await aiStatus(await identity(request)));}catch(error){return failure(error);}}
