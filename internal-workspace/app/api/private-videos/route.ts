import {privateVideos} from '@/lib/private-videos';
export const dynamic='force-dynamic';
export async function GET(request:Request){return privateVideos(request);}
export async function POST(request:Request){return privateVideos(request);}
