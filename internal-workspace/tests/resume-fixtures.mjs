// Fictional fixtures for local tests only. Never seed a hosted candidate profile.
import {zipSync,strToU8} from 'fflate';
export const weakCV='QA Candidate\nqa@example.test\nLooking for a role in cybersecurity. Interested in learning and helping a security team.';
export const strongCV=`QA Candidate
qa@example.test | +234 801 234 5678
SUMMARY
Cybersecurity analyst with practical experience investigating security alerts, improving incident response and documenting clear findings for engineering teams. Experienced in SIEM, Python, Linux and vulnerability management, with a focus on accurate evidence and reliable operational processes.
EXPERIENCE
- Investigated 30 alerts per day using SIEM and documented the findings with clear escalation notes for the response team.
- Automated Python checks across 40 systems to identify configuration changes and reduce repetitive manual review for security analysts.
- Improved Linux monitoring by reviewing access patterns, investigating unusual behavior and documenting the actual results for the operations team.
- Built incident response runbooks and tested the escalation process with colleagues to improve consistency during security investigations.
SKILLS
SIEM, Python, Linux, Incident response, Vulnerability management
EDUCATION
Security studies covering network defense, threat investigation, access management and responsible handling of evidence. Completed practical projects using the tools listed above, recording methods and limitations so another analyst could repeat the work.`;
const xmlEscape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function docxCV(text=strongCV){
 const paragraphs=text.split('\n').map(line=>`<w:p>${line.startsWith('- ')?'<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>':''}<w:r><w:t xml:space="preserve">${xmlEscape(line.replace(/^- /,''))}</w:t></w:r></w:p>`).join('');
 return zipSync({'[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),'word/document.xml':strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`)},{level:6});
}
export function pdfCV(text=strongCV,pages=1){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(let i=0;i<pages;i++){
  // Short lines keep this valid fixture inside the media box.
  const lines=text.split('\n').flatMap(line=>line.match(/.{1,90}(?:\s|$)|.{1,90}/g)||['']);
  const body='BT /F1 8 Tf 40 800 Td 12 TL '+lines.map((line,j)=>`${j?'T* ':''}(${line.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')}) Tj`).join('\n')+' ET';
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(body,'latin1')} >>\nstream\n${body}\nendstream`);
 }
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new Uint8Array(Buffer.from(pdf,'latin1'));
}
