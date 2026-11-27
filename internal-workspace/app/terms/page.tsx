import {requireChatGPTUser} from '../chatgpt-auth';
import LegalNotice from '../legal-notice';
import text from '../../content/terms.md?raw';
export const dynamic='force-dynamic';
export default async function Terms(){await requireChatGPTUser('/terms');return <LegalNotice text={text}/>;}
