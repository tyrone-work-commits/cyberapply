import { retiredAgentResponse } from '@/lib/retired-agent';
export const dynamic='force-dynamic';
export async function GET(){return retiredAgentResponse();}
