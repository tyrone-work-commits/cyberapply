import {saveRecording} from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return saveRecording(request);}
export async function POST(request:Request){return saveRecording(request);}
