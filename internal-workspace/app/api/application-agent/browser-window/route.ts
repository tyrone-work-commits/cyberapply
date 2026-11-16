import {workerBrowserWindow} from '@/lib/application-browser-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){return workerBrowserWindow(request);}
