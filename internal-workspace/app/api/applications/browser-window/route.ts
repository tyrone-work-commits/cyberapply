import {ownerBrowserWindow} from '@/lib/application-browser-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return ownerBrowserWindow(request);}
export async function POST(request:Request){return ownerBrowserWindow(request);}
