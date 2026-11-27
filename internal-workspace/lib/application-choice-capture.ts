import {DomainError,record,type State} from './cyber-domain';
import {employerQuestionKey} from './employer-questions';
import {isLocationMenu,employerChoiceLimit,locationCapture,type LocationChoiceCapture as Capture} from './employer-location-choices';
import {mergeApplicationQuestionChoices} from './employer-question-options';
import {applicationQuestionChoices} from './application-question-choices';

const pending=(c?:Capture)=>c&&['queued','reading'].includes(c.state);
/** One metadata-only recovery per paused run; never requeue the application. */
export function queueMissingLocationChoices(state:State,id:string,at=new Date().toISOString()){
 const request=owned(state,id);
 if(request.status!=='needs_attention'||locationCapture(request.report))return false;
 const rows=Array.isArray(request.report?.questions)?request.report.questions as Record<string,unknown>[]:[];
 const missing=rows.filter(q=>isLocationMenu(String(q.question||''))&&['combobox','select'].includes(String(q.field_type))&&!applicationQuestionChoices(request,q,state.accountProfile?.employerQuestions||[]).options.length);
 if(!missing.length)return false;
 const query=missing.some(q=>/city|^location\s*\*?$/i.test(String(q.question)))?state.accountProfile?.city||'':'';
 try{queueLocationCapture(state,id,query,at);return true;}catch(error){if(error instanceof DomainError)return false;throw error;}
}
function owned(state:State,id:string){const request=state.applications?.find(a=>a.id===id);if(!request)throw new DomainError('This application is no longer available.',404);return request;}
function source(state:State,id:string){const request=owned(state,id),job=state.jobs.find(j=>j.id===request.jobId),s=job?.source;if(!job||s?.provider!=='greenhouse'||!/^\w[\w-]{0,79}$/.test(s.board)||!/^\d{1,30}$/.test(s.externalId)||s.region==='eu')throw new DomainError('Read-only location capture is currently available for these Greenhouse forms only.',409);return job;}
function idle(request:ReturnType<typeof owned>){if(['processing','queued'].includes(request.status))throw new DomainError('Wait for the active application run to finish before reading its menus.',409);}
export function queueLocationCapture(state:State,id:string,cityQuery:string,at=new Date().toISOString()){
 const request=owned(state,id);idle(request);source(state,id);
 const config=state.newApplicationAgent;if(!config?.enabled||Date.parse(config.expiresAt)<=Date.parse(at))throw new DomainError('Reconnect your background agent in Settings before reading live menus.',409);
 const previous=locationCapture(request.report);if(pending(previous)&&Date.parse(previous!.expiresAt)>Date.parse(at))throw new DomainError('This read-only menu capture is already waiting or running.',409);
 if(previous?.completedAt&&Date.parse(at)-Date.parse(previous.completedAt)<15000)throw new DomainError('Wait a few seconds before reading these menus again.',429);
 if(cityQuery.length>120||! /^[\p{L}\p{N} .,'’()\-]*$/u.test(cityQuery))throw new DomainError('Enter a city name of up to 120 characters.');
 const fields=Array.isArray(request.report?.questions)?request.report.questions as Record<string,unknown>[]:[];
 if(!fields.some(q=>isLocationMenu(String(q.question||''))&&['select','combobox'].includes(String(q.field_type))))throw new DomainError('This application has no captured country or city dropdown to refresh.',409);
 const capture:Capture={id:crypto.randomUUID(),state:'queued',at,expiresAt:new Date(Date.parse(at)+120000).toISOString(),cityQuery:cityQuery.trim()};
 request.report={...request.report,locationCapture:capture};
 record(state,'queue_location_choice_capture','Requested a read-only country/city menu inspection. No application was queued.','interface',at);
 return capture;
}
export function claimLocationCapture(state:State,at=new Date().toISOString()){
 if(state.applications?.some(a=>a.status==='processing'||locationCapture(a.report)?.state==='reading'&&Date.parse(locationCapture(a.report)!.expiresAt)>Date.parse(at)))return null;
 for(const request of state.applications||[]){const capture=locationCapture(request.report);if(!pending(capture))continue;
  if(Date.parse(capture!.expiresAt)<=Date.parse(at)){capture!.state='failed';capture!.message='The menu reader timed out. The application was not restarted.';capture!.completedAt=at;continue;}
  if(capture!.state!=='queued')continue;
  try{idle(request);const job=source(state,request.id);capture!.state='reading';
   return {applicationId:request.id,captureId:capture!.id,expiresAt:capture!.expiresAt,cityQuery:capture!.cityQuery,job:{id:job.id,url:job.url,applyUrl:job.applyUrl,source:job.source}};
  }catch{capture!.state='failed';capture!.message='This form is unavailable for read-only capture right now.';capture!.completedAt=at;}
 }
 return null;
}
export function completeLocationCapture(state:State,id:string,captureId:string,rows:Record<string,unknown>[],code:string,at=new Date().toISOString()){
 const request=owned(state,id);idle(request);source(state,id);const capture=locationCapture(request.report);
 if(!capture||capture.id!==captureId||capture.state!=='reading'||Date.parse(capture.expiresAt)<=Date.parse(at))throw new DomainError('This read-only capture is no longer active.',409);
 const recorded=Array.isArray(request.report?.questions)?request.report.questions as Record<string,unknown>[]:[];
 const questions=rows.slice(0,12).filter(q=>isLocationMenu(String(q.question||''))&&['combobox','select'].includes(String(q.field_type))&&recorded.some(old=>employerQuestionKey(String(old.question||''))===employerQuestionKey(String(q.question||''))&&['combobox','select'].includes(String(old.field_type)))).map(q=>({question:q.question,field_type:q.field_type,options:Array.isArray(q.options)?q.options.slice(0,employerChoiceLimit(String(q.question))):[],optionsTruncated:!!q.optionsTruncated,...(q.lookupQuery?{lookupQuery:String(q.lookupQuery).slice(0,120)}:{}),phoneCountry:q.phoneCountry===true}));
 const populated=questions.filter(q=>q.options.length);mergeApplicationQuestionChoices(state,id,populated,at,'browser_read_only');
 const current=locationCapture(request.report)!;current.state=populated.length?'ready':'failed';current.completedAt=at;
 current.message=populated.length?`Captured ${populated.length} country/city menus. ${questions.some(q=>!q.options.length)?'Some menus returned no choices for this search. ':''}Your answers and application status are unchanged.`:code==='verification'?'The employer requires verification before its menus can be read. No application was restarted.':code==='no_results'?'No location choices were returned. Try a different city search; no application was restarted.':'The employer menus could not be read. Your application and saved answers are unchanged.';
 return current.message;
}
