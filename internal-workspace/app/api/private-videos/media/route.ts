import {recordingViewer} from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return recordingViewer(request,true);}
export async function HEAD(request:Request){return recordingViewer(request,true);}
