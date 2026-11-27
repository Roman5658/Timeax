import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {makePayslipPdf,payslipPdfLines} from '../src/hosted/payslip-pdf.ts';

const receipt={
 id:'2ee165d0-0000-4000-8000-123456789abc',issued_at:'2026-11-30T23:30:00Z',sha256:'internal-receipt-hash',
 document:{
  source:{agencyName:'Agencja Żółć',siteName:'Łódź',workerKey:'private-worker-id',workerLabel:{name:'Олексій Їжак'},dateFrom:'2026-11-01',dateTo:'2026-11-30',rows:[{data:{note:'private shift note'}}]},
  calculation:{mode:'gross-rate',amountCents:3000,paidMinutes:6000,rateSnapshot:[],grossCents:300000,netCents:270000,deductions:[{name:'PIT',cents:10000},{name:'Лікарняні',cents:20000}],note:'private accounting note'}
 }
};
const tx=(key,args)=>key==='simpleHours'?args.hours+' h '+args.minutes+' min':key;
test('PDF shows authorized snapshot calculation, accurate Unicode and no technical/private notes',()=>{
 const lines=payslipPdfLines(receipt,tx,'missing','No.','pl');
 assert.deepEqual(lines.slice(0,3),[
  {label:'Agencja Żółć / Łódź'},{label:'worker',value:'Олексій Їжак'},{label:'pdfPeriod',value:'2026-11-01 – 2026-11-30'}
 ]);
 assert.match(lines[3].value,/1[.\/\-]12[.\/\-]2026/); // Warsaw already next day
 assert.deepEqual(lines.slice(4).map(x=>x.label),['approvedHours','grossRatePerHour','gross','PIT','Лікарняні','net']);
 assert.match(lines[6].value,/3\s?000,00 PLN/);assert.match(lines.at(-1).value,/2\s?700,00 PLN/);
 assert.doesNotMatch(JSON.stringify(lines),/internal-receipt|private|undefined/);
 const totalOnly={...receipt,document:{...receipt.document,calculation:{...receipt.document.calculation,mode:'gross-total'}}};
 assert.ok(!payslipPdfLines(totalOnly,tx,'missing','No.','pl').some(x=>x.label.includes('Rate')));
});
test('PDF canvas lays out Unicode, wraps data, breaks pages and emits exact cross-reference offsets',async()=>{
 const drawn=[],dummyJpeg='data:image/jpeg;base64,/9j/2Q==';
 const ctx={scale(){},measureText(s){return {width:Array.from(s).length*8}},fillRect(){},fillText(s,x,y){drawn.push({s,x,y})}};
 const canvas={getContext:()=>ctx,toDataURL:(type)=>{assert.equal(type,'image/jpeg');return dummyJpeg}};
 const previous=globalThis.document;globalThis.document={createElement:type=>{assert.equal(type,'canvas');return canvas}};
 try{
  const lines=payslipPdfLines(receipt,tx,'missing','No.','pl');
  lines.splice(lines.length-1,0,...Array.from({length:40},()=>({label:'Нарахування '.repeat(7),value:'100,00 PLN'})),{label:'Ї'.repeat(70)});
  const res=makePayslipPdf('Розрахунковий листок',lines);
  assert.equal(res.type,'application/pdf');
  const bytes=Buffer.from(await res.arrayBuffer()),source=bytes.toString('latin1');
  assert.match(source,/^%PDF-1\.4/);assert.match(source,/\/MediaBox \[0 0 595.28 841.89\]/);
  const count=Number(source.match(/\/Count (\d+)/)?.[1]);
  assert.ok(count>1);
  assert.equal(source.match(/\/Filter \/DCTDecode/g).length,count);
  assert.ok(drawn.some(x=>x.s==='Agencja Żółć / Łódź'));
  assert.ok(drawn.some(x=>x.s==='Олексій Їжак'));
  assert.ok(drawn.some(x=>x.s==='Розрахунковий листок'));
  assert.ok(drawn.every(x=>x.x>=42&&x.y<=842));
  const xrefAt=Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(source.slice(xrefAt,xrefAt+4),'xref');
  for(const [i,m] of [...source.matchAll(/(\d{10}) 00000 n/g)].entries()){
   const offset=Number(m[1]),marker=(i+1)+' 0 obj';
   assert.equal(source.slice(offset,offset+marker.length),marker);
  }
 }finally{globalThis.document=previous}
});
test('PDF button copy is localized in all supported locales',()=>{
 for(const locale of ['pl','en','ru','uk']){
  const cfg=JSON.parse(readFileSync(new URL('../src/i18n/locales/'+locale+'.json',import.meta.url),'utf8')).canonicalPayslips;
  assert.match(cfg.downloadPdf,/PDF/);assert.ok(cfg.pdfPeriod);assert.ok(cfg.pdfFailed);
 }
});
