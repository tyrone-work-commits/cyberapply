import {z} from 'zod';
import {identity,load,response,failure} from '@/lib/cyber-store';
import {getCareer,updateCareer,privateJson} from '@/lib/career-store';
import {syncNotifications,notificationSettings} from '@/lib/notification-store';
import {notificationPreferencesSchema,type AppNotification} from '@/lib/notifications';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);return response(await syncNotifications(user));}catch(e){return failure(e);}}
const input=z.discriminatedUnion('action',[z.object({action:z.literal('preferences'),version:z.number().int(),data:notificationPreferencesSchema}).strict(),z.object({action:z.literal('read'),id:z.string().max(100),version:z.number().int(),archived:z.boolean().optional()}).strict()]);
export async function POST(request:Request){try{const user=await identity(request);await load(user);const body=input.parse(await privateJson(request));if(body.action==='preferences'){const old=await notificationSettings(user);return response({record:await updateCareer(user,old,body.version,body.data)});}const old=await getCareer<AppNotification>(user,'notifications',body.id);return response({record:await updateCareer(user,old,body.version,{...old.data,read:true,archived:body.archived??old.data.archived})});}catch(e){return failure(e);}}
