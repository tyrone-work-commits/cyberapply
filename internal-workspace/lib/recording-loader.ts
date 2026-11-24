/** One bounded download pool per viewer. Manifest refreshes reuse in-flight work. */
export class RecordingLoader {
 private cache=new Map<string,ArrayBuffer>();
 private pending=new Map<string,Promise<ArrayBuffer>>();
 private queue:Array<()=>void>=[];
 private active=0;
 private bytes=0;
 private wanted:Set<string>|null=null;
 private controller=new AbortController();
 constructor(private fetcher:typeof fetch=fetch,private concurrency=3,private timeout=12000){}
 close(){this.controller.abort();this.cache.clear();this.bytes=0;}
 retain(urls:string[]){this.wanted=new Set(urls);for(const [url,data] of this.cache)if(!this.wanted.has(url)){this.cache.delete(url);this.bytes-=data.byteLength;}}
 async load(url:string){
  const cached=this.cache.get(url);if(cached)return cached;
  const pending=this.pending.get(url);if(pending)return pending;
  const task=new Promise<ArrayBuffer>((resolve,reject)=>{
   this.queue.push(()=>{this.active++;void this.download(url).then(resolve,reject).finally(()=>{this.active--;this.queue.shift()?.();});});
   if(this.active<this.concurrency)this.queue.shift()?.();
  });
  this.pending.set(url,task);
  try{return await task;}finally{this.pending.delete(url);}
 }
 private async download(url:string){
  for(let attempt=0;attempt<2;attempt++){
   this.controller.signal.throwIfAborted();
   const controller=new AbortController(),abort=()=>controller.abort();
   this.controller.signal.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(abort,this.timeout);
   try{
    const response=await this.fetcher(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('video/mp4')){
     await response.body?.cancel();
     throw Error('The private video could not be loaded. Use Refresh video to try again.');
    }
    const reader=response.body?.getReader();if(!reader)throw Error('The private video is empty.');
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size+this.bytes>48_000_000)throw Error('This recording exceeds the playback limit.');chunks.push(next.value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    this.controller.signal.throwIfAborted();
    if(!size)throw Error('The private video is empty.');
    if(size+this.bytes>48_000_000)throw Error('This recording exceeds the playback limit.');
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    if(!this.wanted||this.wanted.has(url)){this.bytes+=size;this.cache.set(url,bytes.buffer);}return bytes.buffer;
   }catch(error){
    if(this.controller.signal.aborted)throw error;
    // Retry only interrupted network reads/timeouts, never access or format errors.
    if(attempt||!controller.signal.aborted&&!(error instanceof TypeError))throw error;
   }finally{clearTimeout(timer);this.controller.signal.removeEventListener('abort',abort);}
  }
  throw Error('Video loading timed out. Use Refresh video to reconnect.');
 }
}
