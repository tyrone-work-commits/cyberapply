import type {DiscoveryReport} from '@/lib/job-catalog';

export default function JobSearchReport({report}:{report?:DiscoveryReport}){
 return <details className="source-report search-last-report"><summary>Last search{report?' · '+new Date(report.at).toLocaleString():''}</summary>{report?<div><p>{report.message}</p>{report.boards.every(board=>board.status==='ok'&&board.matching===0)&&<p>No matches in the selected boards. Try leaving Location empty or turning off Remote only, then search again.</p>}<ul>{report.boards.map(board=><li key={board.key} className={board.status==='error'?'source-failed':''}><span>{board.company}</span><span>{board.status==='error'?board.message:`${board.fetched} published · ${board.matching} match${board.complete?'':' · partial scan'}`}</span></li>)}</ul></div>:<p>No live search has run yet. Use Find live jobs to load employer vacancies.</p>}</details>;
}
