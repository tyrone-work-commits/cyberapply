import {requireChatGPTUser} from '../chatgpt-auth';
import AgentWatch from './watch-view';
export const dynamic='force-dynamic';
export default async function WatchPage({searchParams}:{searchParams:Promise<{request?:string}>}){
 const {request=''}=await searchParams;
 await requireChatGPTUser('/application-watch?request='+encodeURIComponent(request));
 return <AgentWatch requestId={request}/>;
}
