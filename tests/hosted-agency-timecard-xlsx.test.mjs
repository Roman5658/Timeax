import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {buildAgencyTimecardWorkbook,snapshotExportRows,timecardFileName} from '../src/hosted/timecard-xlsx.ts';
const copy={source:'Source',site:'Worksite',factory:'Factory',worker:'Worker',date:'Date',start:'Start',end:'End',gross:'Gross hours',break:'Break',paid:'Paid time',comment:'Comment',total:'Worksite total',worksheet:'Monthly timecard',missingName:'Name not recorded',reference:'No.',internal:'Internal',factorySource:'Factory',timeZone:'Time zone',
 locale:'en-US',scope:'Scope',workerExtract:'Worker extract',breakState:'Break type',breakUnreported:'Not reported',breakNotTaken:'No break',breakPaid:'Paid',breakUnpaid:'Deducted',
 weekday:'Weekday',agency:'Agency',shifts:'Shifts',status:'Status',archived:'Archived',received:'Received',absences:'Absences',notInSnapshot:'Absences are not part of this timecard.',shiftLabel:'Shift'};
const monday='2026-11-02',sunday='2026-11-01';
const snapshot={source:'internal-agency',status:'archived',worksiteId:'10000000-0000-4000-8000-000000000000',worksiteName:'=External()',dateFrom:sunday,dateTo:monday,timeZone:'Europe/Warsaw',paidMinutes:930,rows:[
 {id:'bbb',membershipId:'a1000000-0000-4000-8000-000000000001',workerLabel:{name:'=HYPERLINK("https://example.test")',reference:'15'},data:{localDate:monday,startTime:'21:00',endTime:'05:00',grossMinutes:480,breakMinutes:30,breakStatus:'taken',breakTreatment:'unpaid',paidMinutes:450,comment:'@test'}},
 {id:'aaa',membershipId:'a2000000-0000-4000-8000-000000000002',data:{localDate:sunday,startTime:'08:00',endTime:'16:00',grossMinutes:480,breakMinutes:0,breakStatus:'not-reported',breakTreatment:'unpaid',paidMinutes:480,comment:''}}
]};
async function roundtrip(book){
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 assert.equal(bytes.subarray(0,2).toString(),'PK');
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);return loaded;
}
function minutes(value){
 return value instanceof Date?Math.round((value.getTime()+2209161600000)/60000):Math.round(value*1440);
}
test('legacy visual workbook has worksite totals, separate workers and proper Excel dates/times',async()=>{
 const loaded=await roundtrip(buildAgencyTimecardWorkbook(snapshot,copy)),[summary,first,second]=loaded.worksheets;
 assert.equal(summary.name,'Worksite total');assert.equal(loaded.worksheets.length,3);
 assert.equal(summary.getCell('B3').value,'Internal');
 assert.match(summary.getCell('A2').value,/^=External\(\)/);
 assert.equal(summary.getCell('A2').type,ExcelJS.ValueType.String);
 assert.equal(summary.getCell('G6').value,'—');
 assert.equal(minutes(summary.getCell('F8').value),930);
 assert.equal(summary.getCell('F8').numFmt,'[h]:mm');
 assert.equal(summary.getCell('A5').fill.fgColor.argb,'FF385A48');
 assert.equal(summary.getCell('A8').fill.fgColor.argb,'FFDCE7F2');
 assert.ok([first.name,second.name].includes('Name not recorded'));
 const shiftSheet=[first,second].find(sheet=>sheet.name!=='Name not recorded'),
  sundaySheet=[first,second].find(sheet=>sheet.name==='Name not recorded');
 assert.equal(shiftSheet.getCell('A5').type,ExcelJS.ValueType.String);
 assert.match(shiftSheet.getCell('A5').value,/No. 15$/);
 assert.equal(shiftSheet.getCell('D5').value.toISOString().slice(0,10),monday);
 assert.equal(shiftSheet.getCell('E5').value,'Monday');
 assert.equal(minutes(shiftSheet.getCell('F5').value),21*60);
 assert.equal(minutes(shiftSheet.getCell('G5').value),5*60);
 assert.equal(minutes(shiftSheet.getCell('J5').value),450);
 assert.equal(shiftSheet.getCell('K5').value,'Deducted');
 assert.equal(shiftSheet.getCell('M5').value,'@test');
 assert.equal(shiftSheet.getCell('A5').fill.fgColor.argb,'FFDDF1DF');
 assert.equal(sundaySheet.getCell('A5').fill.fgColor.argb,'FFD5EBE9');
 assert.equal(sundaySheet.getCell('I5').value,'Not reported');
 assert.equal(shiftSheet.autoFilter,'A4:M5');
 assert.equal(snapshot.rows[0].id,'bbb','does not mutate server snapshot');
 assert.match(timecardFileName(snapshot),/^Timeax-agency-.*\.xlsx$/);
});
test('factory-supplied tab shows intact factory and recipient labels, source and receipt',()=>{
 const source={...snapshot,source:'connected-factory',status:'received',factoryName:'Example factory',agencyName:'Example recipient'};
 const [summary,worker]=buildAgencyTimecardWorkbook(source,copy).worksheets;
 assert.equal(summary.getCell('B3').value,'Factory');
 assert.equal(summary.getCell('D3').value,'Received');
 assert.equal(summary.getCell('B4').value,'Example factory');
 assert.equal(summary.getCell('D4').value,'Example recipient');
 assert.equal(worker.getCell('B5').value,'Example recipient');
 assert.match(timecardFileName(source),/^Timeax-factory-.*\.xlsx$/);
});
test('single-worker file isolates membership and marks its scope without changing the whole saved timecard',async()=>{
 const first=snapshot.rows[0],second={...snapshot.rows[1],workerLabel:first.workerLabel};
 const original={...snapshot,rows:[first,second]};
 const full=await roundtrip(buildAgencyTimecardWorkbook(original,copy));
 assert.equal(full.worksheets.length,3);
 assert.notEqual(full.worksheets[1].name,full.worksheets[2].name);
 const extract=await roundtrip(buildAgencyTimecardWorkbook(original,copy,first.membershipId));
 assert.equal(extract.worksheets.length,2);
 const [summary,sheet]=extract.worksheets;
 assert.equal(summary.getCell('B4').value,'Worker extract');
 assert.equal(sheet.getCell('D5').value.toISOString().slice(0,10),monday);
 assert.equal(minutes(summary.getCell('F8').value),450);
 assert.equal(minutes(full.worksheets[0].getCell('F8').value),930);
 assert.throws(()=>snapshotExportRows(original,'other-member'));
 assert.match(timecardFileName(original,first.membershipId),/-worker-a10000000000\.xlsx$/);
 assert.equal(original.rows.length,2);
});
