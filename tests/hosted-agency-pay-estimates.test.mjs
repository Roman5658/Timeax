import assert from 'node:assert/strict';
import test from 'node:test';
import {agencyPayEstimates,estimatesForRows,payEstimateScopeIsFullMonth} from '../src/hosted/agency-pay-estimate.ts';
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
