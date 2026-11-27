import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {buildAgencyTimecardWorkbook,snapshotExportRows,timecardFileName} from '../src/hosted/timecard-xlsx.ts';
const copy={source:'Source',site:'Worksite',factory:'Factory',worker:'Worker',date:'Date',start:'Start',end:'End',gross:'Gross minutes',break:'Break, minutes',paid:'Paid minutes',comment:'Comment',total:'Total paid minutes',worksheet:'Timecard',missingName:'Name not recorded',reference:'No.',internal:'Internal',factorySource:'Received',timeZone:'Time zone'};
const snapshot={source:'internal-agency',status:'archived',worksiteId:'10000000-0000-4000-8000-000000000000',worksiteName:'=External()',dateFrom:'2026-11-01',dateTo:'2026-11-02',timeZone:'Europe/Warsaw',paidMinutes:930,rows:[
  {id:'bbb',membershipId:'a1000000-0000-4000-8000-000000000001',workerLabel:{name:'=HYPERLINK("https://example.test")',reference:'15'},data:{localDate:'2026-11-02',startTime:'21:00',endTime:'05:00',grossMinutes:480,breakMinutes:30,breakStatus:'taken',breakTreatment:'unpaid',paidMinutes:450,comment:'@test'}},
  {id:'aaa',membershipId:'a2000000-0000-4000-8000-000000000002',data:{localDate:'2026-11-01',startTime:'08:00',endTime:'16:00',grossMinutes:480,breakMinutes:0,breakStatus:'not-reported',breakTreatment:'unpaid',paidMinutes:480,comment:''}},
]};
test('real XLSX uses the server-snapshot order, names, numeric minutes and total',async()=>{
  const bytes=await buildAgencyTimecardWorkbook(snapshot,copy).xlsx.writeBuffer();
  assert.equal(Buffer.from(bytes).subarray(0,2).toString(),'PK');
  const loaded=new ExcelJS.Workbook();
  await loaded.xlsx.load(Buffer.from(bytes));
  const sheet=loaded.getWorksheet('Timecard');
  assert.equal(sheet.getCell('B1').value,'Internal');
  assert.equal(sheet.getCell('B2').value,'=External()');
  assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B8').value,'2026-11-01');
  assert.equal(sheet.getCell('A8').value,'Name not recorded');
  assert.equal(sheet.getCell('A9').type,ExcelJS.ValueType.String);
  assert.match(sheet.getCell('A9').value,/No. 15$/);
  assert.equal(sheet.getCell('H9').value,'@test');
  assert.equal(sheet.getCell('G9').value,450);
  assert.equal(sheet.getCell('G10').value,930);
  assert.equal(sheet.autoFilter,'A7:H9');
  assert.ok(sheet.getCell('G8').fill.fgColor.argb);
  assert.equal(snapshot.rows[0].id,'bbb','does not mutate server snapshot');
  assert.match(timecardFileName(snapshot),/^Timeax-agency-.*\.xlsx$/);
});
test('factory-supplied documents have distinct metadata and file name',()=>{
  const source={...snapshot,source:'connected-factory',status:'received',factoryName:'Example factory'};
  const sheet=buildAgencyTimecardWorkbook(source,copy).getWorksheet('Timecard');
  assert.equal(sheet.getCell('B1').value,'Received');
  assert.equal(sheet.getCell('B3').value,'Example factory');
  assert.match(timecardFileName(source),/^Timeax-factory-.*\.xlsx$/);
});
test('single-worker extract is marked, totals only that worker, and preserves the full saved timecard',async()=>{
  const first=snapshot.rows[0];
  const other={...snapshot.rows[1],workerLabel:first.workerLabel}; // same display label, different membership
  const original={...snapshot,rows:[first,other]};
  const messages={...copy,scope:'Scope',workerExtract:'Single-worker extract',breakState:'Break type',
   breakUnreported:'Not reported',breakNotTaken:'No break',breakPaid:'Paid',breakUnpaid:'Deducted'};
  const book=buildAgencyTimecardWorkbook(original,messages,first.membershipId);
  const loaded=new ExcelJS.Workbook();
  await loaded.xlsx.load(Buffer.from(await book.xlsx.writeBuffer()));
  const sheet=loaded.getWorksheet('Timecard');
  assert.equal(sheet.getCell('B6').value,'Single-worker extract');
  assert.equal(sheet.getCell('B8').value,'2026-11-02');
  assert.equal(sheet.getCell('I8').value,'Deducted');
  assert.equal(sheet.getCell('G9').value,450);
  assert.equal(sheet.rowCount,9);
  assert.equal(sheet.autoFilter,'A7:I8');
  const full=buildAgencyTimecardWorkbook(original,messages).getWorksheet('Timecard');
  assert.equal(full.getCell('I8').value,'Not reported');
  assert.equal(full.getCell('G10').value,930);
  assert.throws(()=>snapshotExportRows(original,'other-member'));
  assert.match(timecardFileName(original, first.membershipId),/-worker-a10000000000\.xlsx$/);
  assert.equal(original.rows.length,2);
});

