import {DomainError,type ApplicationRequest} from './cyber-domain';
import {isHumanAgentQuestion} from './verification-question';
export {isHumanAgentQuestion} from './verification-question';
export const RECAPTCHA_HOSTS=['www.google.com','www.recaptcha.net','www.gstatic.com','recaptcha.google.com'];
export const RECAPTCHA_QUESTION='Complete the employer reCAPTCHA in this browser.';
export type VerificationHandoff={profileSyncVersion?:1;persistent?:true;closeReturnsControl?:true;id:string;claimId:string;turn:number;state:'waiting'|'opening'|'opened'|'resuming'|'resumed'|'cancelled'|'expired'|'failed';kind:'question'|'input'|'recaptcha'|'challenge';phase?:'before_submit'|'after_submit';questions:string[];challengeHosts:string[];approvedHosts:string[];at:string;expiresAt:string;code?:'incomplete'|'window_unavailable'|'session_changed'|'connection_lost'};
export function requestCloseReturn(item:ApplicationRequest,id:string,now=Date.now()){
 const h=currentHandoff(item,now);
 if(!h||h.id!==id||h.kind!=='question'||!h.persistent||!h.closeReturnsControl||!['opened','resuming'].includes(h.state))throw new DomainError('Close-and-return is unavailable for this exact human or AI handoff.',409);
 h.state='resuming';delete h.code;h.at=new Date(now).toISOString();return h;
}
export function inputHandoffQuestions(questions:string[]){return questions.length>0&&questions.length<=10&&questions.every(q=>!!q.trim()&&q.length<=300&&!/captcha|password|verification code|security code|one.time.code/i.test(q));}
export function persistentQuestionHandoff(item:ApplicationRequest){
 const h=item.verificationHandoff;return item.status==='processing'&&h?.persistent===true&&(h.kind==='question'&&h.questions.length>0&&h.questions.every(isHumanAgentQuestion)||h.kind==='input'&&inputHandoffQuestions(h.questions))&&h.phase!=='after_submit'&&h.claimId===item.claim?.id&&!h.challengeHosts.length&&!h.approvedHosts.length&&['waiting','opening','opened','resuming'].includes(h.state)?h:null;
}
export function currentHandoff(item:ApplicationRequest,now=Date.now()){
 const h=item.verificationHandoff;
 const scoped=h&&((h.kind==='question'&&h.questions.length>0&&h.questions.every(isHumanAgentQuestion)||h.kind==='input'&&inputHandoffQuestions(h.questions))&&h.phase!=='after_submit'&&!h.challengeHosts.length&&!h.approvedHosts.length||h.kind==='recaptcha'&&h.questions.length===1&&h.questions[0]===RECAPTCHA_QUESTION&&h.challengeHosts.every(host=>RECAPTCHA_HOSTS.includes(host))&&h.approvedHosts.every(host=>h.challengeHosts.includes(host)));
 return h&&scoped&&item.status==='processing'&&item.claim?.id===h.claimId&&(persistentQuestionHandoff(item)||Date.parse(item.claim.expiresAt)>now&&Date.parse(h.expiresAt)>now)? h:null;
}
export function handoffCommand(item:ApplicationRequest,id:string,command:'open'|'resume'|'cancel',approvedHosts:string[],now=Date.now()){
 const h=currentHandoff(item,now);if(!h||h.id!==id)throw new DomainError('This exact browser session is unavailable or expired. No application was restarted.',409);
 if(command==='open'){
  if(h.state!=='waiting')throw new DomainError('The browser is already opening or this handoff is no longer waiting.',409);
  if(h.kind!=='recaptcha'&&approvedHosts.length)throw new DomainError('This form-input handoff does not grant external verification-service access.',409);
  if(h.kind==='recaptcha'&&JSON.stringify([...new Set(approvedHosts)].sort())!==JSON.stringify([...h.challengeHosts].sort()))throw new DomainError('Approve exactly the listed reCAPTCHA destinations for this session.',409);
  if(h.kind==='recaptcha')h.approvedHosts=[...approvedHosts];
  h.state='opening';
 }else if(command==='resume'){
  if(h.state!=='opened')throw new DomainError('Open the exact agent browser and complete the check before resuming.',409);
  h.state='resuming';
 }else{
  if(!['waiting','opening','opened','resuming'].includes(h.state))throw new DomainError('This verification handoff has already ended.',409);
  h.state='cancelled';if(h.persistent&&item.claim)item.claim.expiresAt=new Date(now+120000).toISOString();
 }
 delete h.code;h.at=new Date(now).toISOString();return h;
}
