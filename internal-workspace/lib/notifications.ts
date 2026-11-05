import {z} from 'zod';
import type {State} from './cyber-domain';
import {applicationProgress} from './application-progress';
import {jobFit} from './job-browse';
export const notificationCategories=['scan_available','application_updates','application_reminders','interview_reminders','job_matches','news_tips'] as const;
export const notificationLabels:Record<typeof notificationCategories[number],string>={scan_available:'Scan availability',application_updates:'Application updates',application_reminders:'Saved-job reminders',interview_reminders:'Interview reminders',job_matches:'New job matches',news_tips:'News & tips'};
export const notificationPreferencesSchema=z.object({channels:z.record(z.enum(notificationCategories),z.object({inApp:z.boolean(),email:z.boolean(),push:z.boolean()}).strict()),minimumMatch:z.number().int().min(0).max(100)}).strict().refine(d=>notificationCategories.every(c=>!!d.channels[c]),'Keep preferences for all notification categories.');
export type NotificationPreferences=z.infer<typeof notificationPreferencesSchema>;
export type AppNotification={key:string;category:typeof notificationCategories[number];title:string;body:string;url:string;at:string;read:boolean;archived:boolean};
export const defaultNotificationPreferences=():NotificationPreferences=>({minimumMatch:70,channels:Object.fromEntries(notificationCategories.map(c=>[c,{inApp:true,email:false,push:false}])) as NotificationPreferences['channels']});
export function shouldUpdateDigest(previous:AppNotification,next:AppNotification,prefs:NotificationPreferences){return !!prefs.channels[next.category]?.inApp&&!previous.archived&&next.key===previous.key&&next.key.startsWith('job-digest-')&&(previous.title!==next.title||previous.body!==next.body);}
export function notificationCandidates(state:State,at=new Date().toISOString()):AppNotification[]{return(state.applications||[]).map(a=>{const job=state.jobs.find(j=>j.id===a.jobId),p=applicationProgress(a),version=a.result?.at||a.claim?.at||a.at;return{key:`application-${a.id}-${a.status}-${version}`,category:'application_updates' as const,title:`${job?.company||'Employer'} · ${p.label}`,body:job?.title||'Application request',url:'/workspace?view=applications',at:version,read:false,archived:false};});}
export function jobMatchDigest(state:State,minimum:number,since:string){return state.jobs.filter(j=>Date.parse(j.createdAt)>Date.parse(since)&&j.disposition==='open'&&j.source?.availability!=='closed').map(job=>({job,score:jobFit(job,state.profile.resumeText).score})).filter(r=>r.score!==null&&r.score>=minimum).slice(0,30);}
