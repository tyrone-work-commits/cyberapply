import { requireChatGPTUser } from '../chatgpt-auth';
import { load } from '@/lib/cyber-store';
import Onboarding from './profile-setup';
export const dynamic='force-dynamic';
export default async function ProfileSetup({searchParams}:{searchParams:Promise<{edit?:string}>}){const edit=(await searchParams).edit==='1';const user=await requireChatGPTUser(edit?'/onboarding?edit=1':'/onboarding');const saved=await load(user);return <Onboarding edit={edit} viewer={{email:user.email,displayName:user.displayName}} revision={saved.revision} accountProfile={saved.state.accountProfile} suggestedName={saved.state.profile.fullName||(user.fullName||'')} suggestedRole={saved.state.profile.preferredRoles[0]||''}/>;}
