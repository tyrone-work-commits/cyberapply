import { identity,load,failure } from '@/lib/cyber-store';
import {privateRecordsExport} from '@/lib/export-records';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);const current=await load(user);return new Response(privateRecordsExport(user,current,request.signal),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="cyberapply-records.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return failure(error);}}
