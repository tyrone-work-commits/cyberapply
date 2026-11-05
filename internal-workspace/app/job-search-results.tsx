'use client';
import {useState} from 'react';
import type {Job} from '@/lib/cyber-domain';
export default function JobSearchResults({jobs,onSelect}:{jobs:Job[];onSelect:(job:Job)=>void}){
 const [limit,setLimit]=useState(20);
 return <section className="job-search-list search-vacancy-list" aria-label="Search results"><p>{jobs.length} matching {jobs.length===1?'vacancy':'vacancies'}</p><p className="subtle">Choose a vacancy to open its details, then Apply or Reject.</p>{jobs.slice(0,limit).map(j=><button key={j.id} className="job-search-result" aria-haspopup="dialog" onClick={()=>onSelect(j)}><strong>{j.title}</strong><span>{j.company}</span><small>{j.location||'Location not supplied'} · {j.workMode}</small></button>)}{jobs.length>limit&&<button className="button quiet" onClick={()=>setLimit(limit+20)}>Load more results</button>}{!jobs.length&&<p>No matching vacancies. Try another role or location, or use the live-search button above to find new vacancies.</p>}</section>;
}
