export const MAX_RECORDING_SIZE=40_000_000;
export function recordingPrefix(owner:string,id:string){return `owners/${encodeURIComponent(owner)}/application-recordings/${encodeURIComponent(id)}/`;}
export function recordingKey(owner:string,id:string,attempt:string){return recordingPrefix(owner,id)+attempt+'.mp4';}
export function recordingRange(header:string|null,size:number):{offset:number;length:number}|null|'invalid'{
 if(!header)return null;const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||!size||(!match[1]&&!match[2]))return 'invalid';
 if(!match[1]){const length=Number(match[2]);if(!Number.isSafeInteger(length)||length<=0)return 'invalid';return {offset:Math.max(0,size-length),length:Math.min(size,length)};}
 const start=Number(match[1]),end=match[2]?Number(match[2]):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return 'invalid';
 return {offset:start,length:Math.min(size-1,end)-start+1};
}
