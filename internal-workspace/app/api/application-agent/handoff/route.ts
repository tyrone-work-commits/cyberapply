import {verificationWorker} from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return verificationWorker(request);}
export async function POST(request:Request){return verificationWorker(request);}
