import {identity,load,failure} from '@/lib/cyber-store';
import {getCareer} from '@/lib/career-store';
import {DomainError} from '@/lib/cyber-domain';
import {syncTracker} from '@/lib/tracker-store';
import {trackerCalendar} from '@/lib/tracker';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{secret:string}>}){try{const user=await identity(request),current=await load(user),{secret}=await params,config=await getCareer<{secret:string}>(user,'settings','calendar');if(secret!==config.data.secret+'.ics')throw new DomainError('Calendar link not found or replaced.',404);return new Response(trackerCalendar(await syncTracker(user,current.state)),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="cyberapply-interviews.ics"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return failure(e);}}
