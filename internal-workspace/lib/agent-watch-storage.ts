export const VIDEO_SLOTS=8;
export function watchStorageKeys(owner:string,id:string){
 const prefix=`owners/${encodeURIComponent(owner)}/live-watch/${encodeURIComponent(id)}`;
 const lease=prefix+'/lease',legacy=prefix+'/frame.jpg',manifest=prefix+'/video-manifest',init=prefix+'/init.mp4';
 const segment=(sequence:number)=>prefix+'/segment-'+(sequence%VIDEO_SLOTS)+'.mp4';
 return {lease,legacy,manifest,init,segment,all:[lease,legacy,manifest,init,...Array.from({length:VIDEO_SLOTS},(_,i)=>segment(i))]};
}
