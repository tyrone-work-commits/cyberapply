import {z} from 'zod';
import {applicationWorkerIdentity} from '@/lib/application-agent-server';
import {privateJson} from '@/lib/career-store';
import {refreshDueSources} from '@/lib/saved-job-sources';
import {syncNotifications} from '@/lib/notification-store';
import {response,failure} from '@/lib/cyber-store';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await applicationWorkerIdentity(request);z.object({}).strict().parse(await privateJson(request));const result=await refreshDueSources(user);if(result.results.some(r=>r.refreshed))try{await syncNotifications(user);}catch{console.error('Private notification refresh deferred.');}return response(result);}catch(e){if(e instanceof z.ZodError)return response({error:'Send an empty refresh request.'},400);return failure(e);}}
