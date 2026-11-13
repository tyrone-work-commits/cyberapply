import {requireChatGPTUser} from '../chatgpt-auth';
import AgentWatch from './watch-view';
import {ApplicationRecording} from '../application-recording';
export const dynamic='force-dynamic';
export default async function WatchPage({searchParams}:{searchParams:Promise<{request?:string;mode?:string}>}){
 const {request='',mode}=await searchParams;
 const recording=mode==='recording';
 await requireChatGPTUser('/application-watch?request='+encodeURIComponent(request)+(recording?'&mode=recording':''));
 return recording?<ApplicationRecording requestId={request}/>:<AgentWatch requestId={request}/>;
}
