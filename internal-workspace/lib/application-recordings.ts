export const MAX_RECORDING_SIZE=40_000_000;
export function recordingPrefix(owner:string,id:string){return `owners/${encodeURIComponent(owner)}/application-recordings/${encodeURIComponent(id)}/`;}
export function recordingKey(owner:string,id:string,attempt:string,part?:number){return recordingPrefix(owner,id)+attempt+(part===undefined?'':'-part-'+String(part).padStart(3,'0'))+'.mp4';}
export function recordingStatusKey(owner:string,id:string,attempt:string){return recordingPrefix(owner,id)+attempt+'.status.json';}
export function recordingRange(header:string|null,size:number):{offset:number;length:number}|null|'invalid'{
 if(!header)return null;const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||!size||(!match[1]&&!match[2]))return 'invalid';
 if(!match[1]){const length=Number(match[2]);if(!Number.isSafeInteger(length)||length<=0)return 'invalid';return {offset:Math.max(0,size-length),length:Math.min(size,length)};}
 const start=Number(match[1]),end=match[2]?Number(match[2]):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return 'invalid';
 return {offset:start,length:Math.min(size-1,end)-start+1};
}

// Media reconciliation may outlive the 15-minute form lease, never its owner/claim.
export function recordingClaimValid(item:{status:string;claim?:{id:string;at:string}},claimId:string,now=Date.now()){
 const at=Date.parse(item.claim?.at||'');return item.claim?.id===claimId&&item.status!=='queued'&&Number.isFinite(at)&&at<=now+60000&&at>=now-30*86400000;
}
