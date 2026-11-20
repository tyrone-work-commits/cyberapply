"use client";
import{ExternalLink}from'lucide-react';

/** Open the original employer page independently of the agent's browser session. */
export function ApplicationBrowserButton({url}:{url:string}){
 let destination:string;
 try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)return null;destination=parsed.href;}catch{return null;}
 return <a className="button quiet" href={destination} target="_blank" rel="noopener noreferrer" title="Open employer application in a new tab"><ExternalLink size={15}/>Open employer application<span className="sr-only"> (opens in a new tab)</span></a>;
}
