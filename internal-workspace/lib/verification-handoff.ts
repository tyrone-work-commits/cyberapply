import {DomainError,type ApplicationRequest} from './cyber-domain';
export function isHumanAgentQuestion(label:string){return /^which(?: of (?:the )?following)? best describes you\b/i.test(label.trim().replace(/\s+/g,' '));}
export const RECAPTCHA_HOSTS=['www.google.com','www.recaptcha.net','www.gstatic.com'];
export const RECAPTCHA_QUESTION='Complete the employer reCAPTCHA in this browser.';
export type VerificationHandoff={id:string;claimId:string;turn:number;state:'waiting'|'opening'|'opened'|'resuming'|'resumed'|'cancelled'|'expired'|'failed';kind:'question'|'recaptcha'|'challenge';phase?:'before_submit'|'after_submit';questions:string[];challengeHosts:string[];approvedHosts:string[];at:string;expiresAt:string;code?:'incomplete'|'window_unavailable'|'session_changed'|'connection_lost'};
export function currentHandoff(item:ApplicationRequest,now=Date.now()){
 const h=item.verificationHandoff;
 const scoped=h&&(h.kind==='question'&&h.phase!=='after_submit'&&!h.challengeHosts.length&&!h.approvedHosts.length&&h.questions.length>0&&h.questions.every(isHumanAgentQuestion)||h.kind==='recaptcha'&&h.questions.length===1&&h.questions[0]===RECAPTCHA_QUESTION&&h.challengeHosts.every(host=>RECAPTCHA_HOSTS.includes(host))&&h.approvedHosts.every(host=>h.challengeHosts.includes(host)));
 return h&&scoped&&item.status==='processing'&&item.claim?.id===h.claimId&&Date.parse(item.claim.expiresAt)>now&&Date.parse(h.expiresAt)>now? h:null;
}
export function handoffCommand(item:ApplicationRequest,id:string,command:'open'|'resume'|'cancel',approvedHosts:string[],now=Date.now()){
 const h=currentHandoff(item,now);if(!h||h.id!==id)throw new DomainError('This exact browser session is unavailable or expired. No application was restarted.',409);
 if(command==='open'){
  if(h.state!=='waiting')throw new DomainError('The browser is already opening or this handoff is no longer waiting.',409);
  if(h.kind==='question'&&approvedHosts.length)throw new DomainError('The human-versus-AI dropdown handoff does not grant external verification-service access.',409);
  if(h.kind==='recaptcha'&&JSON.stringify([...new Set(approvedHosts)].sort())!==JSON.stringify([...h.challengeHosts].sort()))throw new DomainError('Approve exactly the listed reCAPTCHA destinations for this session.',409);
  if(h.kind==='recaptcha')h.approvedHosts=[...approvedHosts];
  h.state='opening';
 }else if(command==='resume'){
  if(h.state!=='opened')throw new DomainError('Open the exact agent browser and complete the check before resuming.',409);
  h.state='resuming';
 }else{
  if(!['waiting','opening','opened','resuming'].includes(h.state))throw new DomainError('This verification handoff has already ended.',409);
  h.state='cancelled';
 }
 delete h.code;h.at=new Date(now).toISOString();return h;
}
