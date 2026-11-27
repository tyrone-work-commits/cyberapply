import type { Job, Profile } from './cyber-domain';
import { CANDIDATE_FACTS_ENABLED } from './features';

function clean(value:string,limit:number){return value.replace(/\s+/g,' ').trim().slice(0,limit);}
function contains(line:string,skill:string){return line.toLowerCase().includes(skill.toLowerCase());}

/** A conservative role-specific draft. Every experience sentence comes from the CV. */
export function coverLetter(job:Pick<Job,'title'|'company'|'description'|'skills'>,profile:Profile){
 const title=clean(job.title,180),company=clean(job.company,150),name=clean(profile.fullName,150)||'[Your name]';
 const cvLines=profile.resumeText.split(/\r?\n/).map(line=>clean(line.replace(/^[-•*]\s*/,''),240)).filter(line=>line.length>=25&&line.length<=240);
 const hasCvEvidence=CANDIDATE_FACTS_ENABLED?profile.reviewed:profile.resumeText.trim().length>=20;
 const declared=hasCvEvidence?profile.skills.filter(skill=>job.skills.some(required=>required.toLowerCase()===skill.toLowerCase())&&profile.resumeText.toLowerCase().includes(skill.toLowerCase())):[];
 const actions=hasCvEvidence?cvLines.filter(line=>/\b(built|led|investigated|analyzed|analysed|improved|implemented|monitored|responded|secured|developed|managed|assessed|reduced|documented)\b/i.test(line)):[];
 const evidence=[...actions.filter(line=>declared.some(skill=>contains(line,skill))),...actions].filter((line,index,all)=>all.indexOf(line)===index).slice(0,2);
 const skillLine=declared.length?`Your listing mentions ${declared.slice(0,3).join(', ')}. These skills also appear in my CV.`:'I would welcome a conversation about how my background matches your requirements.';
 const evidenceLine=evidence.length?`My CV records this work: ${evidence.map(line=>`“${line}”`).join(' ')} `:'';
 return `Dear ${company} hiring team,\n\nI am applying for the ${title} role at ${company}. ${skillLine}\n\n${evidenceLine}I would welcome the opportunity to discuss how my experience could support your team.\n\nThank you for considering my application.\n\nKind regards,\n${name}`;
}
