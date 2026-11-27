import {requireChatGPTUser} from '../chatgpt-auth';
import LegalNotice from '../legal-notice';
import text from '../../content/privacy.md?raw';
export const dynamic='force-dynamic';
export default async function Privacy(){await requireChatGPTUser('/privacy');return <LegalNotice text={text}/>;}
