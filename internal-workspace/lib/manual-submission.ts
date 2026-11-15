import {DomainError,type ApplicationRequest} from './cyber-domain';
export type ManualSubmission={id:string;claimId:string;state:'ready'|'needs_submit'|'cancel_requested'|'cancelled'|'confirmed';at:string;updatedAt:string;challengeHosts:string[];approvedHosts:string[];openRequested?:boolean;receipt?:{url:string;text:string}};
/** A waiting browser is never reclaimed or automatically replayed, even offline. */
export function manualSession(item:ApplicationRequest){const h=item.manualSubmission;return item.status==='processing'&&h?.claimId===item.claim?.id?h:null;}
export function manualCommand(item:ApplicationRequest,id:string,command:'open'|'cancel',hosts:string[]=[]){
 const h=manualSession(item);if(!h||h.id!==id||!['ready','needs_submit','cancel_requested'].includes(h.state))throw new DomainError('This exact browser session is unavailable. No new application was started.',409);
 if(command==='cancel'){h.state='cancel_requested';h.openRequested=false;}
 else {if(h.state==='cancel_requested')throw new DomainError('Cancellation is already requested.',409);if(hosts.some(host=>!h.challengeHosts.includes(host)))throw new DomainError('Approve only the displayed reCAPTCHA hosts.',409);h.approvedHosts=[...new Set([...h.approvedHosts,...hosts])];h.openRequested=true;}
 h.updatedAt=new Date().toISOString();return h;
}
