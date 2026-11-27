import type {PayPublication} from './payslips.ts';
import {paidRateSummary} from './payroll-simple.ts';
import {workerLabelText} from './member-label.ts';

type Translate=(key:string,values?:Record<string,unknown>)=>string;
type Line={label:string;value?:string;emphasis?:boolean};

export function payslipPdfLines(p:PayPublication,tx:Translate,missing:string,reference:string,locale:string):Line[]{
 const {source:s,calculation:c}=p.document;
 const money=new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
 const amount=(n:number)=>money.format(n/100)+' PLN';
 const time=(n:number)=>tx('simpleHours',{hours:Math.floor(n/60),minutes:String(n%60).padStart(2,'0')});
 const issue=new Date(p.issued_at);
 return [
  {label:s.agencyName+' / '+s.siteName},
  {label:tx('worker'),value:workerLabelText(s.workerLabel,missing,reference)},
  {label:tx('pdfPeriod'),value:s.dateFrom+' – '+s.dateTo},
  {label:tx('issued'),value:Number.isNaN(issue.getTime())?p.issued_at:issue.toLocaleDateString(locale,{timeZone:'Europe/Warsaw'})},
  {label:tx('approvedHours'),value:time(c.paidMinutes)},
  ...paidRateSummary(c).map(r=>({label:tx(r.basis==='gross'?'grossRatePerHour':'netRatePerHour'),value:amount(r.cents)+' · '+time(r.minutes)})),
  {label:tx('gross'),value:amount(c.grossCents),emphasis:true},
  ...c.deductions.map(d=>({label:d.name,value:'− '+amount(d.cents)})),
  {label:tx('net'),value:amount(c.netCents),emphasis:true},
 ];
}

// Page image XObjects keep the exact device-rendered Unicode glyphs, without
// sending personal fields to a rendering service or shipping a font bundle.
export function makePayslipPdf(title:string,lines:readonly Line[]):Blob{
 const width=620,height=877,scale=2,pad=42,split=326,bottom=810,leading=20;
 const canvas=document.createElement('canvas');
 canvas.width=width*scale;canvas.height=height*scale;
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('pdf-unavailable');
 ctx.scale(scale,scale);ctx.textBaseline='top';
 const setFont=(weight:number,size:number)=>{ctx.font=weight+' '+size+'px system-ui, Arial, sans-serif'};
 const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):undefined;
 const wrap=(input:string,limit:number)=>{
  const all:string[]=[];let line='';
  for(const word of input.trim().split(/\s+/u)){
   if(!word)continue;
   if(ctx.measureText(line?line+' '+word:word).width<=limit){line+=(line?' ':'')+word;continue}
   if(line){all.push(line);line=''}
   if(ctx.measureText(word).width<=limit){line=word;continue}
   const parts=segmenter?Array.from(segmenter.segment(word),part=>part.segment):Array.from(word);
   for(const segment of parts){
    if(line&&ctx.measureText(line+segment).width>limit){all.push(line);line=''}
    line+=segment;
   }
  }
  if(line||!all.length)all.push(line);
  return all;
 };
 const pages:Uint8Array<ArrayBuffer>[]=[];let y=0;
 const start=()=>{
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#19372c';setFont(700,15);ctx.fillText('TIMEAX',pad,pad);
  setFont(700,25);
  const heading=wrap(title,width-2*pad);
  heading.forEach((part,i)=>ctx.fillText(part,pad,pad+27+i*29));
  y=pad+42+heading.length*29;
 };
 const finish=()=>{
  ctx.textAlign='right';ctx.fillStyle='#53665f';setFont(400,11);
  ctx.fillText(String(pages.length+1),width-pad,842);ctx.textAlign='left';
  const encoded=canvas.toDataURL('image/jpeg',.88);
  const prefix='data:image/jpeg;base64,';
  if(!encoded.startsWith(prefix))throw Error('pdf-unavailable');
  pages.push(Uint8Array.from(atob(encoded.slice(prefix.length)),char=>char.charCodeAt(0)));
 };
 start();
 for(const row of lines){
  const weight=row.emphasis?700:400;setFont(weight,15);
  const left=wrap(row.label,row.value===undefined?width-2*pad:split-pad-16);
  const right=row.value===undefined?[]:wrap(row.value,width-pad-split);
  const count=Math.max(left.length,right.length);
  if(y+count*leading+16>bottom&&count*leading+16<=bottom-120){finish();start()}
  for(let i=0;i<count;i++){
   if(y+leading+8>bottom){finish();start()}
   ctx.fillStyle='#172820';setFont(weight,15);
   if(left[i])ctx.fillText(left[i],pad,y+4);
   if(right[i]){ctx.textAlign='right';ctx.fillText(right[i],width-pad,y+4);ctx.textAlign='left'}
   y+=leading;
  }
  ctx.fillStyle='#d9e2de';ctx.fillRect(pad,y+4,width-2*pad,1);y+=15;
 }
 finish();
 return packPayslipPdf(pages,canvas.width,canvas.height);
}

function packPayslipPdf(pages:Uint8Array<ArrayBuffer>[],imageWidth:number,imageHeight:number):Blob{
 const enc=new TextEncoder(),chunks:BlobPart[]=[],offsets:number[]=[0];let bytes=0;
 function write(part:string|Uint8Array<ArrayBuffer>){const chunk=typeof part==='string'?enc.encode(part):part;chunks.push(chunk);bytes+=chunk.byteLength}
 function object(id:number,content:string,stream?:Uint8Array<ArrayBuffer>){
  offsets[id]=bytes;write(id+' 0 obj\n'+content);
  if(stream){write('\nstream\n');write(stream);write('\nendstream')}
  write('\nendobj\n');
 }
 write('%PDF-1.4\n');write(Uint8Array.of(37,226,227,207,211,10));
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');
 object(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>');
 pages.forEach((image,i)=>{
  const page=3+i*3,graphics=enc.encode('q\n595.28 0 0 841.89 0 0 cm\n/Slip Do\nQ');
  object(page,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents '+(page+1)+' 0 R /Resources << /XObject << /Slip '+(page+2)+' 0 R >> >> >>');
  object(page+1,'<< /Length '+graphics.byteLength+' >>',graphics);
  object(page+2,'<< /Type /XObject /Subtype /Image /Width '+imageWidth+' /Height '+imageHeight+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+image.byteLength+' >>',image);
 });
 const xref=bytes;
 write('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join(''));
 write('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 return new Blob(chunks,{type:'application/pdf'});
}

export function downloadPayslipPdf(pdf:Blob,p:PayPublication){
 const period=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
 const name=[period(p.document.source.dateFrom),period(p.document.source.dateTo)].filter(Boolean).join('_');
 const link=document.createElement('a'),url=URL.createObjectURL(pdf);
 link.href=url;link.download='Timeax-payslip'+(name?'-'+name:'')+'.pdf';
 document.body.append(link);
 try{link.click()}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000)}
}
