export type SwipeDirection='pass'|'apply'|'save'|'similar';

/** Search pop-ups leave vertical gestures to the scrollable job description. */
export function horizontalSwipeDirection(dx:number,dy:number,threshold=85):'pass'|'apply'|null{
 const direction=swipeDirection(dx,dy,threshold);
 return direction==='pass'||direction==='apply'?direction:null;
}

/** Down is used only from a dedicated drag handle on touch; the rest of the card keeps page scrolling. */
export function swipeDirection(dx:number,dy:number,threshold=85):SwipeDirection|null{
 if(dy < -threshold && -dy > Math.abs(dx)*1.25)return 'save';
 if(dy > threshold && dy > Math.abs(dx)*1.25)return 'similar';
 if(Math.abs(dx)>threshold && Math.abs(dx)>Math.abs(dy)*1.25)return dx>0?'apply':'pass';
 return null;
}
