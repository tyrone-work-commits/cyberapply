import {identity,load,failure} from '@/lib/cyber-store';
import {getCareer} from '@/lib/career-store';
import {optimizationDocx} from '@/lib/generated-cv';
import type {Optimization} from '@/lib/optimize';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await identity(request);await load(user);const q=new URL(request.url).searchParams;const record=await getCareer<Optimization>(user,'optimize',q.get('id')||'');const bytes=await optimizationDocx(user,record.data,q.get('layout')==='clean');return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="optimized-cv-${record.id.slice(0,8)}.docx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return failure(error);}}
