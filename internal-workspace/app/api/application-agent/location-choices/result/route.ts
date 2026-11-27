import {locationChoicesResult} from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){return locationChoicesResult(request);}
