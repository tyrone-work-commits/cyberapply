'use client';
import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from './workspace';
export type Json = Record<string, any>;
export type RequestOptions = Omit<RequestInit,'body'> & {body?:any;responseType?:'json'|'blob'|'text';auth?:boolean};
export class ApiError extends Error { constructor(message:string,public code='request_failed',public status=400){super(message);this.name='ApiError';} }
export async function fetchApi<T>(path:string,options:RequestOptions={},token?:string):Promise<T> {
 const {responseType='json',auth:_,body,...rest}=options;const headers=new Headers(rest.headers);
 if(token)headers.set('Authorization',`Bearer ${token}`);
 let payload=body;
 if(body!==undefined && !(body instanceof FormData) && !(body instanceof Blob)) {headers.set('Content-Type','application/json');payload=typeof body==='string'?body:JSON.stringify(body);}
 let response:Response;try{response=await fetch(`/api/v1${path}`,{...rest,body:payload,headers,cache:'no-store'});}catch{throw new ApiError('We could not connect. Check your connection and try again.','connection_failed',503);}
 if(!response.ok){let result:Json={};try{result=await response.json();}catch{}const detail=result.detail;const message=typeof detail==='string'?detail:detail?.message||detail?.errors?.map((e:Json)=>`${e.loc?.slice(1).join(' ')}: ${e.message}`).join('; ')||'This action could not be completed. Please try again.';throw new ApiError(message,detail?.code||'request_failed',response.status);}
 if(response.status===204)return undefined as T;
 if(responseType==='blob')return await response.blob() as T;
 if(responseType==='text')return await response.text() as T;
 return await response.json() as T;
}
export function useLoad<T=Json>(path:string|null) {
 const {request,refreshTick,user,demo}=useWorkspace();const [data,setData]=useState<T|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{let active=true;if(!path){setLoading(false);return;}setLoading(true);setError(null);request<T>(path).then(result=>{if(active)setData(result);}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,request,refreshTick,revision,user?.id,demo]);
 return {data,loading,error,reload};
}
