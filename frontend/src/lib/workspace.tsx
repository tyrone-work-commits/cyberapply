'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, fetchApi, RequestOptions } from './api';
import { demoRequest, resetDemo } from './demo';
export type User={id:string;email:string|null;phone?:string|null;email_verified:boolean};
type Session={access_token:string;refresh_token:string;user:User};
type Workspace={user:User|null;demo:boolean;ready:boolean;request:<T=any>(path:string,options?:RequestOptions)=>Promise<T>;notify:(message:string,type?:'success'|'error'|'info')=>void;navigate:(view:string)=>void;view:string;refreshTick:number;refresh:()=>void;login:(session:Session)=>void;logout:()=>Promise<void>;startDemo:()=>void;toasts:{id:number;message:string;type:string}[]};
const WorkspaceContext=createContext<Workspace|null>(null);
export function WorkspaceProvider({children}:{children:React.ReactNode}) {
 const [user,setUser]=useState<User|null>(null);const [demo,setDemo]=useState(false);const [ready,setReady]=useState(false);const [view,setView]=useState('explore');const [refreshTick,setRefreshTick]=useState(0);const [toasts,setToasts]=useState<Workspace['toasts']>([]);
 const sessionRef=useRef<Session|null>(null);const demoRef=useRef(false);const renewing=useRef<Promise<Session>|null>(null);
 const persist=(session:Session|null)=>{sessionRef.current=session;setUser(session?.user||null);try{if(session)sessionStorage.setItem('cyberapply-session',JSON.stringify(session));else sessionStorage.removeItem('cyberapply-session');}catch{}};
 const login=useCallback((session:Session)=>{demoRef.current=false;setDemo(false);try{sessionStorage.removeItem('cyberapply-demo');}catch{}persist(session);},[]);
 const notify=useCallback((message:string,type:'success'|'error'|'info'='success')=>{const id=Date.now()+Math.random();setToasts(list=>[...list.slice(-2),{id,message,type}]);setTimeout(()=>setToasts(list=>list.filter(t=>t.id!==id)),5500);},[]);
 const navigate=useCallback((next:string)=>{setView(next);const url=new URL(location.href);url.searchParams.set('view',next);history.pushState(null,'',url);window.scrollTo({top:0,behavior:'smooth'});},[]);
 const request=useCallback(async<T,>(path:string,options:RequestOptions={}):Promise<T>=>{
  if(demoRef.current)return demoRequest<T>(path,options);
  try{return await fetchApi<T>(path,options,options.auth===false?undefined:sessionRef.current?.access_token);}catch(error){
   if(!(error instanceof ApiError)||error.status!==401||!sessionRef.current?.refresh_token||options.auth===false||['/auth/login','/auth/register','/auth/refresh','/auth/logout','/auth/phone/verify','/auth/oauth/exchange'].includes(path))throw error;
   if(!renewing.current)renewing.current=fetchApi<Session>('/auth/refresh',{method:'POST',body:{refresh_token:sessionRef.current.refresh_token}}).then(async session=>{const current=await fetchApi<User>('/auth/me',{},session.access_token);const canonical={...session,user:current};persist(canonical);return canonical;}).finally(()=>{renewing.current=null;});
   let next:Session;try{next=await renewing.current;}catch(failure){if(failure instanceof ApiError&&failure.status===401){persist(null);notify('Your session ended. Please sign in again.','info');throw new ApiError('Please sign in again.','session_expired',401);}throw failure;}
   return await fetchApi<T>(path,options,next.access_token);
  }
 },[notify]);
 const startDemo=useCallback(()=>{resetDemo();persist(null);demoRef.current=true;setDemo(true);setUser({id:'demo-user',email:'alex@example.com',email_verified:true});try{sessionStorage.setItem('cyberapply-demo','true');}catch{}setView('explore');setRefreshTick(v=>v+1);},[]);
 const logout=useCallback(async()=>{if(!demoRef.current&&sessionRef.current){try{await fetchApi('/auth/logout',{method:'POST'},sessionRef.current.access_token);}catch(error){if(!(error instanceof ApiError)||error.status!==401)notify('Signed out of this browser. The service could not confirm revocation of other sessions.','info');}}persist(null);demoRef.current=false;setDemo(false);try{sessionStorage.removeItem('cyberapply-demo');}catch{}history.replaceState(null,'','/');setView('explore');},[notify]);
 useEffect(()=>{if(location.hash.includes('access_token=')||location.hash.includes('type=recovery')){location.replace(`/auth/callback${location.hash}`);return;}const pop=()=>setView(new URL(location.href).searchParams.get('view')||'explore');pop();window.addEventListener('popstate',pop);const boot=async()=>{try{if(sessionStorage.getItem('cyberapply-demo')==='true'){demoRef.current=true;setDemo(true);setUser({id:'demo-user',email:'alex@example.com',email_verified:true});}else{const stored=sessionStorage.getItem('cyberapply-session');if(stored){const session=JSON.parse(stored);sessionRef.current=session;try{const current=await request<User>('/auth/me');persist({...sessionRef.current!,user:current});}catch{persist(null);}}}}catch{}setReady(true);};void boot();return()=>window.removeEventListener('popstate',pop);},[request]);
 return <WorkspaceContext.Provider value={{user,demo,ready,request,notify,navigate,view,refreshTick,refresh:()=>setRefreshTick(v=>v+1),login,logout,startDemo,toasts}}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace(){const value=useContext(WorkspaceContext);if(!value)throw new Error('Workspace provider is required');return value;}
