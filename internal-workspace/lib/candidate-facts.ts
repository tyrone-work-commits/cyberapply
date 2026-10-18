import type { Profile } from './cyber-domain';

export type CandidateFacts = Pick<Profile, 'fullName' | 'email' | 'skills' | 'preferredRoles'>;

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const sectionPattern = /^(?:summary|professional summary|profile|professional profile|objective|experience|work experience|professional experience|employment history|work history|projects|education|qualifications|certifications?|awards|publications|references|interests|languages|volunteering)\s*:?$/i;
const skillsHeading = /^(?:technical skills|core skills|key skills|skills|core competencies|technical competencies|technologies)(?:\s*:\s*(.*))?$/i;
const roleHeading = /^(?:target roles?|preferred roles?|desired roles?|target positions?|desired positions?|roles? sought|professional title)\s*:\s*(.+)$/i;
const roleTitle = /^(?:(?:junior|senior|lead|principal|staff|associate)\s+)?(?:(?:cyber\s*security|cybersecurity|information security|security|soc|grc|cloud security|software|data|network|systems|application|devops|platform|incident response|threat intelligence)\s+)?(?:analyst|engineer|specialist|consultant|architect|researcher|tester|manager|officer|developer|administrator|responder)$|^(?:(?:junior|senior|lead|principal|staff|associate)\s+)?penetration tester$/i;
const skillCategory = /^(?:programming languages?|languages?|frontend|front end|backend|back end|databases?|machine learning(?:\s*&\s*data)?|data|tools?(?:\s*&\s*platforms?)?|platforms?|frameworks?|cloud|security tools?|other skills?)\s*:\s*/i;

function cleanLine(line: string) { return line.replace(/\s+/g, ' ').trim(); }
function cleanItem(value: string) { return value.replace(/^[\s•*\-–—]+/, '').replace(/[.;:]+$/, '').trim(); }
function roleItems(value: string) {
  return [...new Set(value.split(/[,;|]/).map(cleanItem).filter(item => item.length >= 4 && item.length <= 80 && !/[\d@]/.test(item) && !/[.!?]/.test(item)))].slice(0, 5);
}

/** Extract only visible CV statements; this is a suggestion, never a confirmed candidate claim. */
export function extractCandidateFacts(text: string): Partial<CandidateFacts> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(cleanLine).filter(Boolean);
  const facts: Partial<CandidateFacts> = {};
  const email = text.slice(0, 6000).match(emailPattern)?.[0];
  if (email && email.length <= 254) facts.email = email;

  const nameLabel = lines.slice(0, 12).map(line => line.match(/^(?:full name|name)\s*:\s*(.+)$/i)?.[1]).find(Boolean);
  const nameCandidates = nameLabel ? [nameLabel] : lines.slice(0, 8);
  const name = nameCandidates.map(cleanLine).find(line => {
    const words = line.split(/\s+/);
    return line.length <= 80 && words.length >= 2 && words.length <= 5 &&
      words.every(word => /^[\p{L}][\p{L}'’\-]*$/u.test(word)) &&
      !/\b(?:curriculum|vitae|resume|résumé|profile|summary|experience|education|skills|email|phone|address|linkedin|github|security|cybersecurity|analyst|engineer|consultant|manager|specialist|developer)\b/i.test(line);
  });
  if (name) facts.fullName = name;

  const role = lines.slice(0, 24).map(line => line.match(roleHeading)?.[1]).find(Boolean);
  if (role) facts.preferredRoles = roleItems(role);
  else {
    const headline = lines.slice(0, 6).find(line => line.length <= 80 && !line.includes('@') && roleTitle.test(line) && !/[.!?]/.test(line));
    if (headline) facts.preferredRoles = [headline];
  }

  const headingIndex = lines.findIndex(line => skillsHeading.test(line));
  if (headingIndex >= 0) {
    const headingTail = lines[headingIndex].match(skillsHeading)?.[1]?.trim() || '';
    const values = headingTail ? [headingTail] : [];
    for (const line of lines.slice(headingIndex + 1, headingIndex + 7)) {
      if (sectionPattern.test(line) || skillsHeading.test(line) || roleHeading.test(line)) break;
      values.push(line);
    }
    const items = values.join('\n').split(/[,;|•\n]/).map(cleanItem).map(item => item.replace(skillCategory, '').trim())
      .filter(item => item.length >= 2 && item.length <= 65 && item.split(/\s+/).length <= 6 && !/[!?@]/.test(item) && !/\b(?:experience|experienced|worked|using|developed|responsible|supported|managed)\b/i.test(item) && !/^(?:and|or|none)$/i.test(item));
    const deduped = [...new Map(items.map(item => [item.toLocaleLowerCase(), item])).values()].slice(0, 40);
    if (deduped.length) facts.skills = deduped;
  }
  return facts;
}
