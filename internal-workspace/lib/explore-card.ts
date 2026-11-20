import type {Job} from './cyber-domain';
import {extractJobDetails} from './job-extraction';
import {requirementSections} from './job-browse';

/** Every visible badge comes from the vacancy, never from guessed applicant/company facts. */
export function exploreCardFacts(job:Job){
 const details=job.extracted||extractJobDetails(job.description,job.title).extracted,sections=requirementSections(job.description);
 const tags:{kind:string;label:string;evidence?:string}[]=[];
 if(job.workMode&&job.workMode!=='Unspecified')tags.push({kind:'work',label:job.workMode});
 if(details.level)tags.push({kind:'level',label:details.level.charAt(0).toUpperCase()+details.level.slice(1)});
 if(job.employmentType)tags.push({kind:'type',label:job.employmentType.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())});
 if(details.education.length)tags.push({kind:'education',label:details.education.join(' · ')});
 if(job.companySize)tags.push({kind:'size',label:job.companySize+' employees'});
 return{tags,required:sections.required,preferred:sections.preferred};
}
