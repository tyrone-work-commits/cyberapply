import {watchStorageKeys} from './agent-watch-storage';
import {recordingPrefix} from './application-recordings';
export type ApplicationCleanupRow={request_id:string;cover_key:string|null};
type CleanupStore={rows:()=>Promise<ApplicationCleanupRow[]>;complete:(id:string)=>Promise<void>;count:()=>Promise<number>};
type CleanupBucket={delete:(keys:string[])=>Promise<unknown>;list:(options:{prefix:string;limit:number})=>Promise<{objects:{key:string}[]}>};
/** Idempotent private-media cleanup after the guarded record deletion commits.
 * Pending rows survive storage errors, response loss and bounded request budgets.
 * Never reads CVs, restores application records or interacts with an employer.
 */
export async function cleanApplicationMedia(owner:string,store:CleanupStore,bucket:CleanupBucket,budget=12){
 let remaining=budget;
 try{for(const row of await store.rows()){
  if(remaining<2)break;
  const keys=watchStorageKeys(owner,row.request_id).all;
  if(row.cover_key?.startsWith(`owners/${encodeURIComponent(owner)}/career/application-letter-`))keys.push(row.cover_key);
  await bucket.delete(keys);remaining--;
  // Application deletion keeps recordings. Only disposable live-buffer keys
  // and the former cover-letter attachment are cleaned here.
  await store.complete(row.request_id);
 }}catch{/* Keep the committed records deleted and the cleanup row recoverable. */}
 return {cleanupPending:await store.count()};
}
