export type SwipeDirection='pass'|'apply'|'save';

/** Ignore short drags and ambiguous diagonals; downward motion is page scrolling. */
export function swipeDirection(dx:number,dy:number,threshold=85):SwipeDirection|null{
 if(dy < -threshold && -dy > Math.abs(dx)*1.25)return 'save';
 if(Math.abs(dx)>threshold && Math.abs(dx)>Math.abs(dy)*1.25)return dx>0?'apply':'pass';
 return null;
}
