import type {ApplicationRequest} from './cyber-domain';
import {currentHandoff,persistentQuestionHandoff} from './verification-handoff';
import {manualSession} from './manual-submission';

export function applicationLiveState(item:ApplicationRequest,now=Date.now()){
 const handoff=currentHandoff(item,now),manual=manualSession(item);
 const active=item.status==='queued'||item.status==='processing'&&!!item.claim&&(Date.parse(item.claim.expiresAt)>now||!!persistentQuestionHandoff(item)||!!manual);
 const human=handoff&&['waiting','opening','opened','resuming'].includes(handoff.state);
 const answersNeeded=item.status==='needs_attention';
 const control=human?(handoff.state==='resuming'?'resuming':handoff.state==='opened'?'manual':'needs_input'):manual?'submit':answersNeeded?'needs_input':item.status==='queued'?'queued':active?'agent':'ended';
 const privateCheck=!!human&&handoff.kind==='recaptcha'||manual?.verificationStage==='email_code';
 return {active,control,privateCheck,message:control==='manual'?'You have control. Fill the requested fields in the exact agent browser, then return control.':control==='needs_input'?answersNeeded?'Agent has requested user input. Answer this employer’s questions in Applications, then approve and save your answers. This live viewer will continue automatically when new footage arrives.':'Agent has requested user input. Open the exact agent browser below.':control==='resuming'?'Checking your answers in the same browser before resuming.':control==='submit'?manual?.verificationStage==='email_code'?'The employer is requesting an emailed verification code. Complete this privately in the same browser; the code is not recorded.':manual?.processingError?'The employer displayed a submission error. The same browser remains open; check the outcome before trying again.':'Ready — submit it yourself in the agent browser.':control==='queued'?'Waiting for the background agent. This live viewer will continue automatically.':control==='ended'?'This browser run has ended. Any available recording remains below.':'The agent is filling your application.'};
}
