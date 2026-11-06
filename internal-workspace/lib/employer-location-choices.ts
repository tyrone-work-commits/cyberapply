/** Location menus can contain the complete international calling-country list. */
export const isLocationMenu=(question:string)=>/^(?:country|(?:location\s*\(?\s*)?city\)?|location)\s*\*?$/i.test(question.trim());
export const employerChoiceLimit=(question:string)=>isLocationMenu(question)?400:100;
export type LocationChoiceCapture={id:string;state:'queued'|'reading'|'ready'|'failed';at:string;expiresAt:string;cityQuery:string;message?:string;completedAt?:string};
export function locationCapture(report?:Record<string,unknown>){return report?.locationCapture as LocationChoiceCapture|undefined;}
