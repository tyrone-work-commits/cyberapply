import type {ApplicationRequest} from './cyber-domain';
import {currentHandoff,persistentQuestionHandoff} from './verification-handoff';
import {manualSession} from './manual-submission';

export function applicationLiveState(item:ApplicationRequest,now=Date.now()){
 const handoff=currentHandoff(item,now),manual=manualSession(item);
 const active=item.status==='queued'||item.status==='processing'&&!!item.claim&&(Date.parse(item.claim.expiresAt)>now||!!persistentQuestionHandoff(item)||!!manual);
 const human=handoff&&['waiting','opening','opened','resuming'].includes(handoff.state);
 const control=human?(handoff.state==='resuming'?'resuming':handoff.state==='opened'?'manual':'needs_input'):manual?'submit':item.status==='queued'?'queued':active?'agent':'ended';
 const privateCheck=!!human&&handoff.kind==='recaptcha';
 return {active,control,privateCheck,message:control==='manual'?'You have control. Fill the requested fields in the exact agent browser, then return control.':control==='needs_input'?'Agent paused — your input is needed. Open the exact agent browser below.':control==='resuming'?'Checking your answers in the same browser before resuming.':control==='submit'?'Ready — submit it yourself in the agent browser.':control==='queued'?'Waiting for the background agent.':control==='ended'?'This live session ended. Replay the saved recording below.':'The agent is filling your application.'};
}
