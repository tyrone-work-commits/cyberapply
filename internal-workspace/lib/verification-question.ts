/** Only the employer's explicitly scoped human/AI dropdown wording. */
export function isHumanAgentQuestion(label:string){return /^which(?: of (?:the )?following)? best describes you\b/i.test(label.trim().replace(/\s+/g,' '));}
