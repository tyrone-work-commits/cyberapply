import {unzipSync} from 'fflate';
import {getDocumentProxy} from 'unpdf';
import type {Formatting} from './scan-engine';
export async function inspectResumeFormatting(bytes:Uint8Array,name:string):Promise<Formatting>{
 if(bytes.length>5000000)throw new Error('Choose a file smaller than 5 MB.');
 if(/\.docx$/i.test(name)){
  let entries=0,total=0;const parts=unzipSync(bytes,{filter:e=>{if(++entries>1000||e.originalSize>2000000)throw new Error('Document layout is too complex.');const selected=/^word\/(?:document|styles|fontTable|header\d+|footer\d+)\.xml$/.test(e.name);if(selected&&(total+=e.originalSize)>4000000)throw new Error('Document layout is too complex.');return selected;}});
  const xml=new TextDecoder().decode(parts['word/document.xml']||new Uint8Array());if(!xml||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsupported document layout.');
  const styles=new TextDecoder().decode(parts['word/styles.xml']||new Uint8Array());
  const fonts=[...new Set([...((xml+' '+styles).matchAll(/w:(?:ascii|hAnsi)="([^"]+)"/g))].map(m=>m[1]))].slice(0,30);
  const fontSizes=[...new Set([...(xml+' '+styles).matchAll(/<w:sz\s+w:val="(\d+)"/g)].map(m=>Number(m[1])/2))].filter(n=>n>0&&n<200);
  const column=xml.match(/<w:cols\b[^>]*w:num="(\d+)"/);const margins=xml.match(/<w:pgMar\b[^>]*>/)?.[0];const size=xml.match(/<w:pgSz\b[^>]*>/)?.[0];
  const dimensions=(s:string|undefined)=>s?[...s.matchAll(/w:(top|bottom|left|right|w|h)="(\d+)"/g)].map(m=>`${m[1]} ${(Number(m[2])/1440).toFixed(2)} in`).join(', '):undefined;
  return{fonts,fontSizes,tables:[...xml.matchAll(/<w:tbl(?:\s|>|\/)/g)].length,images:[...xml.matchAll(/<(?:w:drawing|w:pict)(?:\s|>|\/)/g)].length,columns:column?Number(column[1]):1,headers:Object.keys(parts).some(n=>/\/header/.test(n)),footers:Object.keys(parts).some(n=>/\/footer/.test(n)),margins:dimensions(margins),pageSize:dimensions(size),colouredText:[...xml.matchAll(/<w:color\b[^>]*w:val="([^"]+)"/g)].some(m=>!['000000','auto'].includes(m[1].toLowerCase())),note:'DOCX structure inspection. Check the rendered document as well; inherited styling can affect appearance.'};
 }
 if(/\.pdf$/i.test(name)){
  const pdf=await getDocumentProxy(bytes.slice(),{useWorkerFetch:false,disableFontFace:true,useSystemFonts:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,enableXfa:false,useWasm:false});
  try{if(pdf.numPages>20)throw new Error('Choose a CV with no more than 20 pages.');const fonts=new Set<string>(),sizes=new Set<number>();let pageSize='';
   for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),view=page.getViewport({scale:1}),content=await page.getTextContent();if(content.items.length>50000)throw new Error('PDF layout is too complex.');pageSize=`${Math.round(view.width)} × ${Math.round(view.height)} pt`;for(const style of Object.values(content.styles))if(style.fontFamily)fonts.add(style.fontFamily);for(const item of content.items)if('transform' in item){const size=Math.round(Math.hypot(item.transform[2],item.transform[3])*10)/10;if(size>0&&size<200)sizes.add(size);}page.cleanup();}
   return{fonts:[...fonts].slice(0,30),fontSizes:[...sizes].sort((a,b)=>a-b),pages:pdf.numPages,pageSize,note:'PDF font and page metadata inspected. Tables, images, margins, columns and headers are unverified; check the preview rather than assuming they are absent.'};
  }finally{await pdf.loadingTask.destroy();}
 }
 return{note:'Pasted/plain text has no font or page-layout metadata.'};
}
