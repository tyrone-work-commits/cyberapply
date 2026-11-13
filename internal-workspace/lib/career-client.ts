export async function careerRequest<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const form=body instanceof FormData;const response=await fetch(path,{method,cache:'no-store',signal:AbortSignal.timeout(30000),...(body===undefined?{}:form?{body}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 let data:unknown;try{data=await response.json();}catch{throw new Error(response.status===401?'Sign in again to open your private career tools.':'The service did not return a readable response. Your saved work is safe.');}
 if(!response.ok)throw new Error((data as {error?:string}).error||'The operation could not be completed.');return data as T;
}
