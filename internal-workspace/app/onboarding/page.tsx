import { requireChatGPTUser } from '../chatgpt-auth';
import { load } from '@/lib/cyber-store';
import Onboarding from './profile-setup';
export const dynamic='force-dynamic';
export default async function ProfileSetup(){const user=await requireChatGPTUser('/onboarding');const saved=await load(user);return <Onboarding viewer={{email:user.email,displayName:user.displayName}} revision={saved.revision} accountProfile={saved.state.accountProfile} suggestedName={saved.state.profile.fullName||(user.fullName||'')} suggestedRole={saved.state.profile.preferredRoles[0]||''}/>;}
