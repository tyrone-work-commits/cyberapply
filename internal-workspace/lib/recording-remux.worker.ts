import {combineRecordingParts} from './continuous-recording';
self.onmessage=(event:MessageEvent<ArrayBuffer[]>)=>{
 try{const bytes=combineRecordingParts(event.data);self.postMessage({bytes},{transfer:[bytes]});}
 catch(error){self.postMessage({error:(error as Error).message});}
};
