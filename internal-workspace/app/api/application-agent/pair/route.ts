import { pair } from '@/lib/application-agent-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return pair(request);}
export async function POST(request:Request){return pair(request);}
export async function DELETE(request:Request){return pair(request);}
