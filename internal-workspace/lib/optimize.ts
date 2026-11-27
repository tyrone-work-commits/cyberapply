import {hardSkillAliases} from './scan-taxonomy';
import {scanResume,type ScanInput,type ScanReport} from './scan-engine';
export type ResumeBlock={id:string;section:string;text:string;original:string};
export type Suggestion={id:string;blockId:string;before:string;after:string;reason:string;skillsAdded:string[];requiresEvidence:boolean;status:'pending'|'accepted'|'rejected'};
export type Optimization={scanId:string;name:string;source:ScanInput&{resumeId?:string;sourceKey?:string};blocks:ResumeBlock[];suggestions:Suggestion[];originalReport:ScanReport;report:ScanReport;archived:boolean};
export function splitResume(text:string):ResumeBlock[]{let section='Profile';return text.split('\n').filter(line=>line.trim()).slice(0,500).map((line,i)=>{if(/^[A-Z\s&/()-]{3,60}$/.test(line.trim()))section=line.trim();return{id:`block-${i}`,section,text:line.trim(),original:line.trim()};});}
export function resumeText(blocks:ResumeBlock[]){return blocks.map(b=>b.text.trim()).filter(Boolean).join('\n');}
export function unsupportedRewrite(before:string,after:string){
 const numbers=(s:string)=>new Set(s.match(/\d+(?:[,.]\d+)*(?:%)?/g)||[]);const known=numbers(before);if([...numbers(after)].some(n=>!known.has(n)))return 'The draft introduced a number or date not present in its evidence.';
 for(const [skill,aliases] of Object.entries(hardSkillAliases)){const terms=[skill,...aliases];const found=(text:string)=>terms.some(term=>new RegExp('(?<![\\p{L}\\p{N}])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}])','iu').test(text));if(found(after)&&!found(before))return `The draft introduced ${skill} without CV evidence.`;}
 const qualifications=/\b(?:PhD|Ph\.D|MSc|BSc|MBA|Bachelor[^\n,.]{0,50}|Master[^\n,.]{0,50}|Doctorate[^\n,.]{0,50}|Certified[^\n,.]{0,60})\b/gi;
 for(const match of after.matchAll(qualifications))if(!before.toLowerCase().includes(match[0].toLowerCase()))return 'The draft introduced a qualification not present in its evidence.';
 const connectives=new Set('a an the and or to of in on for with by as at from my i me our your this that these those is are was were have has had be been can could would will through using use used support supported worked working relevant experience background professional summary skills work responsibilities role evidence bring contribute learn team teams processes practice practical focus focused maintaining maintained built developed investigated improved reduced increased automated implemented performed managed monitored tested secured configured documented assessed reviewed helped delivered supported coordinated provided'.split(' '));
 const words=new Set((before.toLowerCase().match(/[\p{L}][\p{L}\p{N}+#.-]*/gu)||[]));
 const novel=(after.toLowerCase().match(/[\p{L}][\p{L}\p{N}+#.-]*/gu)||[]).filter(w=>!words.has(w)&&!connectives.has(w));if(novel.length)return 'The draft adds wording beyond the supplied evidence. Edit it yourself or use the original text.';
 return '';
}
export function basicSuggestions(session:Optimization):Suggestion[]{
 const rows:Suggestion[]=[];const add=(block:ResumeBlock,after:string,reason:string,requiresEvidence=false,skillsAdded:string[]=[])=>rows.push({id:crypto.randomUUID(),blockId:block.id,before:block.text,after,reason,requiresEvidence,skillsAdded,status:'pending'});
 for(const block of session.blocks){
  if(/references available (?:up)?on request/i.test(block.text))add(block,'','This line usually uses space without adding evidence.');
  if(/\bresponsible for\b/i.test(block.text))add(block,block.text.replace(/\bresponsible for\b/i,'Worked on'),'Use a direct description while retaining the original evidence.');
 }
 for(const skill of session.report.hardSkills.filter(s=>!s.matched).slice(0,8)){
  const block=session.blocks.find(b=>/skill/i.test(b.section))||session.blocks.at(-1);
  if(block)add(block,'',`${skill.skill} is requested but not evidenced in this CV. Describe a real example before adding it; the agent will not claim this skill for you.`,true,[skill.skill]);
 }
 return rows.slice(0,20);
}
export function optimizeFrom(scanId:string,data:ScanInput&{title?:string;resumeId?:string;sourceKey?:string}):Optimization{const report=scanResume(data);return{scanId,name:data.title||'CV optimization',source:{...data},blocks:splitResume(data.resumeText),suggestions:[],originalReport:report,report,archived:false};}
export function changeSuggestion(session:Optimization,id:string,decision:'accept'|'reject',evidence?:string){
 const next=structuredClone(session);const s=next.suggestions.find(s=>s.id===id);if(!s||s.status!=='pending')throw new Error('This suggestion is no longer pending. Reload the editor.');const block=next.blocks.find(b=>b.id===s.blockId);if(!block)throw new Error('The target paragraph is no longer present.');
 if(decision==='reject'){s.status='rejected';return next;}
 if(block.text!==s.before)throw new Error('This paragraph changed since the suggestion. Generate fresh suggestions.');
 if(s.requiresEvidence){if(!evidence?.trim()||evidence.length>4000)throw new Error('Write your real experience before accepting this skill suggestion.');block.text=block.text+'\n'+evidence.trim();s.after=evidence.trim();}
 else{const issue=unsupportedRewrite(s.before,s.after);if(issue)throw new Error(issue);block.text=s.after;}
 s.status='accepted';next.report=scanResume({...next.source,resumeText:resumeText(next.blocks)});return next;
}
export function editOptimization(session:Optimization,blocks:ResumeBlock[]){if(!blocks.length||blocks.length>500||new Set(blocks.map(b=>b.id)).size!==blocks.length||resumeText(blocks).length>120000)throw new Error('Keep a readable CV with no more than 500 paragraphs and 120,000 characters.');const next=structuredClone(session);next.blocks=blocks;next.report=scanResume({...next.source,resumeText:resumeText(blocks)});return next;}
export function phraseIdeas(skill:string){return [`[Edit with your real evidence] Used ${skill} to [actual task], supporting [actual result].`,`[Edit with your real evidence] Investigated [real issue] using ${skill}; documented [actual findings].`,`[Edit with your real evidence] Improved [real process] with ${skill}, achieving [verified result].`];}
export function basicSummary(text:string,targetTitle=''){const lines=text.split('\n').map(s=>s.trim().replace(/^[-•*]\s*/,''));const evidence=lines.filter(s=>/^(?:built|developed|investigated|improved|implemented|managed|monitored|secured|supported|automated)\b/i.test(s)&&s.length>20&&s.length<500).slice(0,2);if(!evidence.length)return '';return (targetTitle?`Target role: ${targetTitle}.\n`:'')+evidence.map(s=>/[.!?]$/.test(s)?s:s+'.').join(' ');}
