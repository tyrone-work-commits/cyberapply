import {DomainError,type ApplicationRequest} from './cyber-domain';
export const VERIFICATION_HOSTS=['www.google.com','www.recaptcha.net','www.gstatic.com','js.hcaptcha.com','api.hcaptcha.com','newassets.hcaptcha.com','challenges.cloudflare.com'];
export type VerificationHandoff={id:string;claimId:string;turn:number;state:'waiting'|'opening'|'opened'|'resuming'|'resumed'|'cancelled'|'expired'|'failed';kind:'question'|'challenge';questions:string[];challengeHosts:string[];approvedHosts:string[];at:string;expiresAt:string;code?:'incomplete'|'window_unavailable'|'session_changed'|'connection_lost'};
export function currentHandoff(item:ApplicationRequest,now=Date.now()){
 const h=item.verificationHandoff;
 return h&&item.status==='processing'&&item.claim?.id===h.claimId&&Date.parse(item.claim.expiresAt)>now&&Date.parse(h.expiresAt)>now? h:null;
}
export function handoffCommand(item:ApplicationRequest,id:string,command:'open'|'resume'|'cancel',approvedHosts:string[],now=Date.now()){
 const h=currentHandoff(item,now);if(!h||h.id!==id)throw new DomainError('This exact browser session is unavailable or expired. No application was restarted.',409);
 if(command==='open'){
  if(h.state!=='waiting')throw new DomainError('The browser is already opening or this handoff is no longer waiting.',409);
  if(JSON.stringify([...new Set(approvedHosts)].sort())!==JSON.stringify([...h.challengeHosts].sort()))throw new DomainError('Approve only the listed verification-service destinations for this session.',409);
  h.approvedHosts=[...approvedHosts];h.state='opening';
 }else if(command==='resume'){
  if(h.state!=='opened')throw new DomainError('Open the exact agent browser and complete the check before resuming.',409);
  h.state='resuming';
 }else{
  if(!['waiting','opening','opened','resuming'].includes(h.state))throw new DomainError('This verification handoff has already ended.',409);
  h.state='cancelled';
 }
 delete h.code;h.at=new Date(now).toISOString();return h;
}
