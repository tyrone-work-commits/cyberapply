import { redirect } from 'next/navigation';
import { requireChatGPTUser } from '../chatgpt-auth';
import { load } from '@/lib/cyber-store';
import Workspace from '../workspace';
export const dynamic='force-dynamic';
export default async function WorkspacePage({searchParams}:{searchParams:Promise<{mode?:string|string[];tour?:string|string[]}>}){
 const params=await searchParams;
 if(params.mode)redirect('/workspace');
 const user=await requireChatGPTUser('/workspace');
 const saved=await load(user);
 if(!saved.state.accountProfile)redirect('/onboarding');
 return <Workspace viewer={{displayName:saved.state.accountProfile.fullName,email:user.email}} replayTour={params.tour==='1'}/>;
}
