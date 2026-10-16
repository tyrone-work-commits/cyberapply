import { redirect } from 'next/navigation';
import { requireChatGPTUser } from '../chatgpt-auth';
import { load } from '@/lib/cyber-store';
import Workspace from '../workspace';
export const dynamic='force-dynamic';
export default async function WorkspacePage({searchParams}:{searchParams:Promise<{mode?:string|string[]}>}){const params=await searchParams;return <ProtectedWorkspace mode={params.mode==='personal'?'personal':'demo'}/>;}
async function ProtectedWorkspace({mode}:{mode:'demo'|'personal'}){const user=await requireChatGPTUser(`/workspace?mode=${mode}`);const saved=await load(user);if(!saved.state.accountProfile)redirect('/onboarding');return <Workspace viewer={{displayName:saved.state.accountProfile.fullName,email:user.email}}/>;}
