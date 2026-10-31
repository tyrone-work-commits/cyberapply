import { cv } from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return cv(request);}
