// A link opens the employer page only; it never queues or submits an application.
export function applicationEmployerLink(application:{sourceUrl:string},job?:{applyUrl?:string;url?:string}){
 for(const value of [job?.applyUrl,application.sourceUrl,job?.url]){
  if(!value)continue;
  try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{}
 }
 return null;
}
