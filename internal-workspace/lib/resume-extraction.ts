import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { getDocumentProxy } from 'unpdf';
import { DomainError } from './cyber-domain';

const MAX_TEXT=120_000,MAX_XML=2_000_000,MAX_PAGES=20;
export type ExtractedResume={text:string;format:'PDF'|'DOCX'|'TXT';type:string;pages?:number;warnings:string[]};
function readable(text:string){
 const cleaned=text.replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(cleaned.length>MAX_TEXT)throw new DomainError('Choose a CV with no more than 120,000 characters of text.',413);
 if((cleaned.match(/[\p{L}\p{N}]/gu)||[]).length<20)throw new DomainError('We could not read enough CV text to give a useful score. For a scanned PDF, export a searchable PDF or DOCX, or paste its text below. Your previous CV has been kept.',422);
 return cleaned;
}
function docxText(bytes:Uint8Array){
 let entries=0,oversized=false;
 const extracted=unzipSync(bytes,{filter:entry=>{entries++;if(entries>1000)throw new DomainError('This Word file has too many entries. Export a simpler DOCX or PDF.',422);if(entry.name!=='word/document.xml')return false;if(entry.originalSize>MAX_XML){oversized=true;return false;}return true;}});
 if(oversized)throw new DomainError('This Word document is too complex. Export a simpler DOCX or searchable PDF.',422);
 const document=extracted['word/document.xml'];
 if(!document||document.length>MAX_XML)throw new DomainError('This is not a readable DOCX document. Export the CV as DOCX, searchable PDF or UTF-8 TXT.',422);
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(document);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new DomainError('This Word file uses unsupported XML declarations. Export a fresh DOCX or PDF.',422);
 const parser=new SaxesParser({xmlns:true});let content='',inText=false,numbered=false,documentSeen=false;
 const word=(uri:string)=>uri==='http://schemas.openxmlformats.org/wordprocessingml/2006/main'||uri==='http://purl.oclc.org/ooxml/wordprocessingml/main';
 parser.on('opentag',tag=>{if(!word(tag.uri))return;if(tag.local==='document')documentSeen=true;if(tag.local==='p'){content+='\n';numbered=false;}if(tag.local==='numPr'&&!numbered){content+='• ';numbered=true;}if(tag.local==='t')inText=true;if(tag.local==='tab')content+='\t';if(tag.local==='br'||tag.local==='cr')content+='\n';});
 parser.on('text',value=>{if(inText){content+=value;if(content.length>MAX_TEXT)throw new DomainError('Choose a CV with no more than 120,000 characters of text.',413);}});
 parser.on('closetag',tag=>{if(!word(tag.uri))return;if(tag.local==='t')inText=false;if(tag.local==='p')content+='\n';if(tag.local==='tc')content+='\t';});
 parser.on('error',error=>{throw error;});parser.write(xml).close();
 if(!documentSeen)throw new DomainError('The Word document does not contain CV text in a supported format.',422);
 return content;
}
export async function extractResume(bytes:Uint8Array,name:string):Promise<ExtractedResume>{
 const extension=name.split('.').pop()?.toLowerCase();
 try{
  if(extension==='txt'){
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(text.includes('\0'))throw new DomainError('Use a UTF-8 TXT file without binary content.',422);
   return {text:readable(text),format:'TXT',type:'text/plain',warnings:[]};
  }
  if(extension==='docx'&&bytes[0]===80&&bytes[1]===75)return {text:readable(docxText(bytes)),format:'DOCX',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',warnings:['Check the extracted text below, especially content originally in tables or columns.']};
  if(extension==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'){
   const pdf=await getDocumentProxy(bytes.slice(),{useWorkerFetch:false,disableFontFace:true,useSystemFonts:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,enableXfa:false,useWasm:false,stopAtErrors:true});
   try{
    if(pdf.numPages>MAX_PAGES)throw new DomainError(`Choose a CV with no more than ${MAX_PAGES} PDF pages.`,422);
    const parts:string[]=[];let length=0;
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
     const page=await pdf.getPage(pageNumber),content=await page.getTextContent();let line='';
     for(const item of content.items)if('str' in item){line+=item.str+(item.hasEOL?'\n':' ');if(line.length+length>MAX_TEXT)throw new DomainError('Choose a CV with no more than 120,000 characters of text.',413);}
     parts.push(line);length+=line.length;page.cleanup();
    }
    return {text:readable(parts.join('\n\n')),format:'PDF',type:'application/pdf',pages:pdf.numPages,warnings:['This review checks extracted text. Check reading order and layout yourself, particularly for columns, tables or graphics.']};
   }finally{await pdf.loadingTask.destroy();}
  }
  throw new DomainError('The file content does not match a supported PDF, DOCX or UTF-8 TXT CV.',422);
 }catch(error){
  if(error instanceof DomainError)throw error;
  if(error instanceof Error&&error.name==='PasswordException')throw new DomainError('This PDF is password protected. Upload an unlocked copy so its text can be reviewed. Your previous CV has been kept.',422);
  throw new DomainError('We could not read this CV file. Export a fresh searchable PDF, DOCX or UTF-8 TXT, or paste its text below. Your previous CV has been kept.',422);
 }
}
