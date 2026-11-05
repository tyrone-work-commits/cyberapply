'use client';
import {Bookmark,Compass} from 'lucide-react';
import type {Job} from '@/lib/cyber-domain';
import {SwipeDeck} from './swipe-deck';
import ExploreJobCard from './explore-job-card';
import './explore-experience.css';

export default function ExploreExperience({jobs,view,limit,busy,canUndo,pending,blocked,error,onLoadMore,onDecide,onSave,onUndo,onDetails,onSimilar}:{jobs:Job[];view:'cards'|'grid';limit:number;busy:boolean;canUndo:boolean;pending:number;blocked:boolean;error?:string;onLoadMore:()=>void;onDecide:(job:Job,decision:'pass'|'apply')=>void;onSave:(job:Job)=>void;onUndo:()=>void;onDetails:(job:Job)=>void;onSimilar:(job:Job)=>void}){
 const card=jobs[0],render=(job:Job,compact=false)=><ExploreJobCard key={job.id} job={job} compact={compact} busy={busy} onSave={()=>onSave(job)} onDetails={()=>onDetails(job)} onSimilar={()=>onSimilar(job)} onApply={()=>onDecide(job,'apply')} onPass={()=>onDecide(job,'pass')}/>;
 const empty=<div className="explore-empty"><Compass size={31}/><h2>No more vacancies to review right now.</h2><p>Available vacancies in your account appear here automatically. Jobs you’ve saved or acted on remain in Saved and Applications.</p></div>;
 return <section className={'explore-reference '+(view==='grid'?'explore-reference-grid':'explore-reference-cards')} aria-label="Explore vacancies"><h1 className="explore-sr-only">Explore jobs</h1>{view==='cards'?<div className={'explore-card-layout'+(!card?' is-empty':'')}><SwipeDeck job={card} disabled={busy} canUndo={canUndo} pending={pending} blocked={blocked} error={error} onDecide={onDecide} onSave={onSave} onUndo={onUndo} onSimilar={onSimilar} empty={empty}>{card&&render(card)}</SwipeDeck></div>:<><div className="explore-reference-grid-list">{jobs.length?jobs.slice(0,limit).map(job=>render(job,true)):empty}</div>{jobs.length>limit&&<button type="button" className="button quiet" onClick={onLoadMore}>Load more jobs</button>}{canUndo&&<button type="button" className="button quiet explore-grid-undo" disabled={busy} onClick={onUndo}>Undo last choice</button>}</>}<p className="explore-page-hint"><Bookmark size={13}/>Save a role with the bookmark. Apply progress appears in Applications.</p></section>;
}
