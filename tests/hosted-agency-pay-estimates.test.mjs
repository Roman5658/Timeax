import assert from 'node:assert/strict';
import test from 'node:test';
import {agencyPayEstimates,applyPayEstimateOverrides,payRateOverrideKey,estimatesForRows,payEstimateScopeIsFullMonth} from '../src/hosted/agency-pay-estimate.ts';
import {buildAgencyTimecardWorkbook} from '../src/hosted/timecard-xlsx.ts';
import {payEstimateCopy} from '../src/hosted/pay-estimate-copy.ts';

const a='worker-A',b='worker-B',foreign='other-org-worker';
const row=(membershipId,localDate,paidMinutes,i=0)=>({
 id:membershipId+':'+localDate+':'+i,membershipId,revision:1,workerLabel:{name:membershipId},worksiteId:'site',worksiteName:'Example site',liveState:'recorded',
 data:{localDate,paidMinutes,grossMinutes:paidMinutes,breakMinutes:0,breakStatus:'not-reported',breakTreatment:'unpaid',startTime:'08:00',endTime:'10:00',comment:''}
});
const report=rows=>({source:'internal-live',status:'preview',organizationId:'agency',worksiteId:'site',worksiteName:'Example site',dateFrom:'2026-10-01',dateTo:'2026-11-30',timeZone:'Europe/Warsaw',rows,
 paidMinutes:rows.reduce((n,x)=>n+x.data.paidMinutes,0)});
const rate=(workerId,effectiveMonth,basis,rateCents,deductions=[])=>({workerId,effectiveMonth,basis,rateCents,deductions,revision:1});
const deduction=(name,cents)=>({name,cents});
const scope={kind:'month',month:'2026-11',site:'',days:[1,2,3,4,5,6,0],search:''};
const copy={source:'Source',site:'Worksite',factory:'Factory',worker:'Worker',date:'Date',start:'Start',end:'End',gross:'Gross hours',break:'Break',paid:'Paid',comment:'Comment',total:'Worksite total',worksheet:'Monthly timecard',missingName:'Name not recorded',reference:'No.',internal:'Internal',factorySource:'Factory',timeZone:'Time zone',locale:'en-US',scope:'Scope',workerExtract:'Worker extract',breakState:'Break type',breakUnreported:'Not reported',breakNotTaken:'No break',breakPaid:'Paid',breakUnpaid:'Deducted',weekday:'Weekday',agency:'Agency',shifts:'Shifts',status:'Status',archived:'Archived',received:'Received',absences:'Absences',notInSnapshot:'Absences are not part of this timecard.',shiftLabel:'Shift',
 preview:{status:'Preview',source:'Filtered',notice:'Draft only',total:'Preview total',recorded:'Recorded'},wages:payEstimateCopy('en')};
test('hourly rates follow historic month changes; monthly cents are rounded once and deductions are never duplicated',()=>{
 const wages=agencyPayEstimates(report([row(a,'2026-10-10',90),row(a,'2026-11-01',30),row(a,'2026-11-05',30),row(b,'2026-11-02',1),row(b,'2026-11-03',1)]),
  [rate(a,'2026-09','net',2400),rate(a,'2026-11','gross',3000,[deduction('Insurance',350),deduction('Other',150)]),rate(b,'2026-09','net',1000)],'2026-11');
 assert.deepEqual(wages.get(a).months.map(p=>[p.basis,p.paidMinutes,p.hourlyBaseCents,p.netCents]),[['net',90,3600,3600],['gross',60,3000,2500]]);
 assert.equal(wages.get(a).netCents,6100);
 assert.equal(wages.get(b).netCents,33);
});
test('site/day/date-range filters suppress gross-to-net conversion, and missing periods suppress total',()=>{
 assert.equal(payEstimateScopeIsFullMonth(scope),'2026-11');
 for(const filter of [{site:'one-site'},{days:[1,2]},{kind:'date-range'},{search:'name'}])assert.equal(payEstimateScopeIsFullMonth({...scope,...filter}),undefined);
 const records=report([row(a,'2026-10-02',60),row(a,'2026-11-02',60),row(b,'2026-11-02',60)]);
 const base=[rate(a,'2026-11','gross',3000,[deduction('Rent',500)]),rate(b,'2026-11','net',2500)];
 const estimates=agencyPayEstimates(records,base);
 assert.equal(estimates.get(a).netCents,undefined);
 assert.equal(estimates.get(a).months[0].status,'missing-rate');
 assert.equal(estimates.get(a).months[1].status,'partial-scope');
 assert.equal(estimates.get(a).months[1].hourlyBaseCents,3000);
 assert.deepEqual(estimates.get(a).months[1].deductions,[]);
 assert.equal(estimates.get(b).netCents,2500);
});
test('does not assume unknown deductions are zero or report negative take-home',()=>{
 const records=report([row(a,'2026-11-02',60),row(b,'2026-11-02',60)]);
 const estimates=agencyPayEstimates(records,[rate(a,'2026-11','gross',3000),rate(b,'2026-11','gross',3000,[deduction('Entered',4000)])],'2026-11');
 assert.equal(estimates.get(a).months[0].status,'missing-deductions');
 assert.equal(estimates.get(b).months[0].status,'deductions-exceed-gross');
 assert.equal(estimates.get(a).netCents,undefined);
 assert.equal(estimates.get(b).netCents,undefined);
});
test('salary worksheet is explicit opt-in, limited to exact internal rows and excluded from saved or received files',()=>{
 const records=report([row(a,'2026-11-02',60),row(b,'2026-11-02',120)]);
 const rates=[rate(a,'2026-11','gross',3000,[deduction('=Sensitive deduction',500)]),rate(b,'2026-11','net',2500)];
 const estimates=agencyPayEstimates(records,rates,'2026-11');
 estimates.set(foreign,estimates.get(b));
 const wageSheet='Preliminary wages';
 assert.equal(buildAgencyTimecardWorkbook(records,copy).getWorksheet(wageSheet),undefined);
 const workerFile=buildAgencyTimecardWorkbook(records,copy,a,estimates).getWorksheet(wageSheet);
 assert.equal(workerFile.rowCount,4);
 assert.equal(workerFile.getCell('A4').value,a);
 assert.equal(workerFile.getCell('E4').value,30);
 assert.equal(workerFile.getCell('H4').value,25);
 assert.equal(typeof workerFile.getCell('G4').value,'string');
 assert.match(workerFile.getCell('G4').value,/^=Sensitive deduction/);
 assert.equal(estimatesForRows([row(a,'2026-11-02',10)],estimates).length,0);
 const archived={...records,source:'internal-agency',status:'archived'};
 const received={...records,source:'connected-factory',status:'received',factoryName:'Plant',agencyName:'Agency'};
 for(const source of [archived,received])assert.equal(buildAgencyTimecardWorkbook(source,copy,undefined,estimates).getWorksheet(wageSheet),undefined);
});
test('common summary and individual sheets visibly show numeric rates/basis and amounts for each month only once',async()=>{
 const multiSite={...row(a,'2026-11-04',120),worksiteId:'other-site',worksiteName:'Other internal'};
 const records=report([row(a,'2026-10-20',60),row(a,'2026-11-02',60),multiSite,row(b,'2026-11-02',60)]);
 const estimates=agencyPayEstimates(records,[rate(a,'2026-10','net',2500),rate(a,'2026-11','gross',3000,[deduction('Insurance',500)])]);
 const workbook=buildAgencyTimecardWorkbook(records,copy,undefined,estimates);
 const output=new (await import('exceljs')).default.Workbook();
 await output.xlsx.load(await workbook.xlsx.writeBuffer());
 const salaryRows=sheet=>sheet.getRows(1,sheet.rowCount).filter(r=>r.getCell(1).value===a&&/^[0-9]{4}-[0-9]{2}$/.test(r.getCell(2).value));
 const expected=[['2026-10',25,'netto','—',25],['2026-11',30,'brutto',90,'—']];
 for(const sheet of [output.worksheets[0],output.getWorksheet(a),output.getWorksheet('Preliminary wages')]){
  const rows=salaryRows(sheet);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>[r.getCell(2).value,r.getCell(4).value,
   /PLN\/h (netto|brutto)/.exec(r.getCell(4).numFmt)[1],r.getCell(5).value,r.getCell(8).value]),expected);
  assert.match(rows[1].getCell(9).value,/full month across all worksites/);
 }
 const summary=output.worksheets[0];
 const link=summary.getRows(1,summary.rowCount).find(r=>r.getCell(1).value?.text==='Preliminary wages').getCell(1).value;
 assert.match(link.hyperlink,/^#'Preview total'!A[0-9]+$/);
 const only=buildAgencyTimecardWorkbook(records,copy,a,estimates);
 assert.equal(only.getWorksheet(b),undefined);assert.equal(salaryRows(only.worksheets[0]).length,2);
 assert.equal(buildAgencyTimecardWorkbook(records,copy).worksheets[0].getRows(1,8).some(r=>r.getCell(1).value?.text==='Preliminary wages'),false);
});
test('timecard-only rate overrides recalculate exact worker/month and keep original settings unchanged',()=>{
 const records=report([row(a,'2026-10-08',60),row(a,'2026-11-02',60),row(a,'2026-11-03',60),row(b,'2026-11-03',60)]);
 const settings=[rate(a,'2026-10','net',1800),rate(a,'2026-11','gross',3000,[deduction('Insurance',500)]),rate(b,'2026-11','net',2500)];
 const original=agencyPayEstimates(records,settings,'2026-11'),key=payRateOverrideKey(a,'2026-11');
 const edited=applyPayEstimateOverrides(original,new Map([[key,{rateCents:4000,basis:'gross'}]]));
 const november=edited.get(a).months[1];
 assert.equal(november.override,true);
 assert.equal(november.hourlyBaseCents,8000);assert.equal(november.netCents,7500);
 assert.deepEqual(november.deductions,[deduction('Insurance',500)]);
 assert.equal(edited.get(a).netCents,9300);
 assert.equal(edited.get(b).netCents,2500);
 assert.equal(original.get(a).months[1].netCents,5500);assert.equal(settings[1].rateCents,3000);
 const book=buildAgencyTimecardWorkbook(records,copy,a,edited).getWorksheet(a);
 const editedRow=book.getRows(1,book.rowCount).find(r=>r.getCell(2).value==='2026-11');
 assert.equal(editedRow.getCell(4).value,40);assert.equal(editedRow.getCell(8).value,75);
 assert.match(editedRow.getCell(9).value,/Rate changed for this timecard only/);
 const net=applyPayEstimateOverrides(original,new Map([[key,{rateCents:7000,basis:'net'}]])).get(a).months[1];
 assert.equal(net.netCents,14000);assert.deepEqual(net.deductions,[]);
 const partial=agencyPayEstimates(records,settings);
 const filtered=applyPayEstimateOverrides(partial,new Map([[key,{rateCents:4000,basis:'gross'}]])).get(a).months[1];
 assert.equal(filtered.netCents,undefined);assert.equal(filtered.status,'partial-scope');assert.deepEqual(filtered.deductions,[]);
 const invalid=applyPayEstimateOverrides(original,new Map([[key,{rateCents:-1,basis:'net'}]])).get(a).months[1];
 assert.equal(invalid.rateCents,3000);
});
