import { getChatGPTUser, chatGPTSignInPath } from './chatgpt-auth';
import EntryScreen from './entry-screen';
export const dynamic='force-dynamic';
export default async function Home(){const user=await getChatGPTUser();return <EntryScreen email={user?.email} signInHref={user?'/onboarding':chatGPTSignInPath('/onboarding')} signUpHref={user?'/onboarding?intent=signup':chatGPTSignInPath('/onboarding?intent=signup')}/>;}
