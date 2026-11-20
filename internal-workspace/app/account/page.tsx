import { requireChatGPTUser, chatGPTSignOutPath } from '../chatgpt-auth';
import AccountPanel from './account-panel';

export const dynamic='force-dynamic';

export default async function AccountPage(){
  const user=await requireChatGPTUser('/account');
  return <AccountPanel email={user.email} signOutHref={chatGPTSignOutPath('/')}/>;
}
