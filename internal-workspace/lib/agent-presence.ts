export const PRESENCE_MAX_AGE=75_000;
export type PresenceRow={token_hash:string;state:string;seen_at:string};
export function runnerPresence(config:{enabled:boolean;tokenHash:string;expiresAt:string}|undefined,row:PresenceRow|null,now=Date.now()){
 const valid=!!config?.enabled&&Date.parse(config.expiresAt)>now;
 if(!valid)return {runnerState:config?.enabled?'reconnect_required':'disconnected',runnerLastSeenAt:undefined};
 if(!row||row.token_hash!==config!.tokenHash)return {runnerState:'not_reporting',runnerLastSeenAt:undefined};
 const age=now-Date.parse(row.seen_at);
 if(!Number.isFinite(age)||age<0||age>PRESENCE_MAX_AGE)return {runnerState:'not_reporting',runnerLastSeenAt:row.seen_at};
 return {runnerState:row.state,runnerLastSeenAt:row.seen_at};
}
