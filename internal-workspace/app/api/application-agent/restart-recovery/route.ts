import {restartRecovery} from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){return restartRecovery(request);}
