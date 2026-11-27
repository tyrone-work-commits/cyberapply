export type PlaybackPoint={time:number;paused:boolean;ended:boolean;hadMedia:boolean};
export function dvrTarget(mode:'live'|'beginning',duration:number){return mode==='live'&&Number.isFinite(duration)?Math.max(0,duration-1.25):0;}
/** Appending footage never skips unwatched work; only an explicit Go live jumps. */
export function resumeVideo(point:PlaybackPoint,duration:number,initialLive=false){
 const end=Number.isFinite(duration)?Math.max(0,duration-.01):0;
 return {time:point.hadMedia?Math.min(end,Math.max(0,Number.isFinite(point.time)?point.time:0)):initialLive?dvrTarget('live',duration):0,paused:point.hadMedia&&point.paused&&!point.ended};
}
