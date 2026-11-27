export const LIVE_SEARCH_INTERVAL_MS=60_000;
export type SearchCooldown={remainingMs:number};

/** Relative server time keeps the interface independent of the visitor's clock. */
export function liveSearchCooldown(lastSearchAt:string|undefined,now=Date.now()):SearchCooldown{
 const last=Date.parse(lastSearchAt||'');
 return {remainingMs:Number.isFinite(last)?Math.max(0,Math.min(LIVE_SEARCH_INTERVAL_MS,last+LIVE_SEARCH_INTERVAL_MS-now)):0};
}

export function countdownSeconds(readyAt:number,now=Date.now()){
 return Math.max(0,Math.ceil((readyAt-now)/1000));
}
