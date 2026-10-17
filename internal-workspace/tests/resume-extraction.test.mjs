import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {strongCV,pdfCV,docxCV} from './resume-fixtures.mjs';
await mkdir('.sites-runtime/resume-tests',{recursive:true});
for(const name of ['cyber-domain','resume-extraction']){
 const source=(await readFile(`lib/${name}.ts`,'utf8')).replace("'./cyber-domain'","'./cyber-domain.mjs'");
 await writeFile(`.sites-runtime/resume-tests/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
}
const {extractResume}=await import('../.sites-runtime/resume-tests/resume-extraction.mjs');
test('UTF-8 CV text preserves Unicode and readable paragraphs',async()=>{const result=await extractResume(strToU8(strongCV+'\nQA Unicode: résumé, sécurité, 李明'),'qa.txt');assert.equal(result.format,'TXT');assert.ok(result.text.includes('résumé, sécurité, 李明'));assert.deepEqual(result.warnings,[]);});
test('Word extracts numbered bullets and text without reading external relationships',async()=>{const result=await extractResume(docxCV(),'qa.docx');assert.equal(result.format,'DOCX');assert.ok(result.text.includes('• Investigated 30 alerts'));assert.ok(result.text.includes('EDUCATION'));assert.equal(result.warnings.length,1);});
test('PDF extracts readable text inside the runtime without network calls',async()=>{const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('CV parsing must not use external services');};try{const result=await extractResume(pdfCV(),'qa.pdf');assert.equal(result.format,'PDF');assert.equal(result.pages,1);assert.ok(result.text.includes('Investigated 30 alerts'));assert.equal(calls,0);}finally{globalThis.fetch=originalFetch;}});
test('unreadable PDFs, invalid files and binary TXT fail with useful errors',async()=>{for(const [bytes,name] of [[pdfCV(''),'scan.pdf'],[strToU8('not PDF'),'fake.pdf'],[strToU8('%PDF-1.4\nbroken'),'bad.pdf'],[new Uint8Array([255,254,0,1]),'bad.txt'],[strToU8('a'.repeat(25)+'\0'),'binary.txt'],[docxCV(),'wrong.pdf']])await assert.rejects(extractResume(bytes,name),e=>e.status===422);});
test('long PDF documents and text are bounded before review',async()=>{await assert.rejects(extractResume(pdfCV('QA fixture',21),'long.pdf'),/20 PDF pages/);await assert.rejects(extractResume(strToU8('a'.repeat(120001)),'long.txt'),e=>e.status===413);});
test('DOCX rejects entity declarations and oversized XML before expansion',async()=>{for(const xml of ['<!DOCTYPE document [<!ENTITY x "ignored">]><document/>','<document>'+'x'.repeat(2000001)+'</document>'])await assert.rejects(extractResume(zipSync({'word/document.xml':strToU8(xml)}),'bad.docx'),e=>e.status===422);});
test('DOCX rejects missing or invalid main document instead of scoring arbitrary archives',async()=>{for(const file of [zipSync({'other.txt':strToU8(strongCV)}),zipSync({'word/document.xml':strToU8('<unclosed>')})])await assert.rejects(extractResume(file,'bad.docx'),e=>e.status===422);});
test('DOCX entry count is bounded even when entries are not extracted',async()=>{const entries=Object.fromEntries(Array.from({length:1001},(_,i)=>[`ignored-${i}`,strToU8('')]));await assert.rejects(extractResume(zipSync(entries),'too-many.docx'),/too many entries/);});
// Reused only for local browser upload verification.
await mkdir('.sites-runtime/fixtures',{recursive:true});
await writeFile('.sites-runtime/fixtures/qa-cv.pdf',pdfCV());
await writeFile('.sites-runtime/fixtures/qa-cv.docx',docxCV());
await writeFile('.sites-runtime/fixtures/qa-cv.txt',strongCV);
await writeFile('.sites-runtime/fixtures/qa-unreadable.pdf',pdfCV(''));
