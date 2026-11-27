import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateDisplayedPay,payslipCents,completeRateSnapshot,paidRateSummary,payrollRateRoster,
 rateSelection,sameRateSelection,storeRateSelection,MAX_RATE_BATCH} from '../src/hosted/payroll-simple.ts';

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [org,person,internal,external,factory,alice,bob,chris,foreign]=Array.from({length:9},(_,i)=>uuid(i+1));
const now=Date.UTC(2026,10,27,12), date=(n)=>new Date(now+n).toISOString();
const setup={
 memberships:[{id:person,organizationId:org,kind:'agency',role:'agency_admin'}],
 worksites:[{id:internal,name:'Factory 1',ownerKind:'agency',ownerId:org,organizationId:org},{id:foreign,name:'Not our site',ownerKind:'agency',ownerId:foreign,organizationId:foreign}],
 connections:[{agencyId:org,factoryId:factory,worksiteId:external,state:'active'}],
 assignments:[
  {membershipId:alice,worksiteId:internal,organizationId:org,role:'worker',state:'active',startsAt:date(-900)},
  {membershipId:alice,worksiteId:internal,organizationId:org,role:'worker',state:'active',startsAt:date(-900)},
  {membershipId:bob,worksiteId:internal,organizationId:org,role:'worker',state:'active',startsAt:date(-900),endsAt:date(0)},
  {membershipId:chris,worksiteId:internal,organizationId:org,role:'worker',state:'active',startsAt:date(1)},
  {membershipId:foreign,worksiteId:internal,organizationId:foreign,role:'worker',state:'active',startsAt:date(-900)}]
};
const connected={organizationId:org,role:'agency_admin',membershipId:person,sites:[{id:external,name:'Factory 2',factoryId:factory}],placements:[
 {agencyId:org,worksiteId:external,membershipId:bob,state:'approved',startsAt:date(-8)},
 {agencyId:org,worksiteId:external,membershipId:chris,state:'pending',startsAt:date(-8)},
 {agencyId:foreign,worksiteId:external,membershipId:foreign,state:'approved',startsAt:date(-8)}
]};
const own=[alice,bob,chris].map(id=>({id}));

test('production selection is exact active, scoped roster (internal/connected), with no future or foreign workers',()=>{
 const actual=payrollRateRoster(org,person,own,setup,connected,now);
 assert.deepEqual(actual,[{id:internal,name:'Factory 1',workerIds:[alice]},{id:external,name:'Factory 2',workerIds:[bob]}]);
 assert.deepEqual(payrollRateRoster(org,uuid(652),own,setup,connected,now),[]);
 assert.equal(payrollRateRoster(org,person,own,setup,{...connected,membershipId:uuid(652)},now).length,1);
 assert.deepEqual(rateSelection([bob,alice],own.map(w=>w.id)),[alice,bob]);
 assert.equal(rateSelection([alice,alice],[alice]),undefined);
 assert.equal(rateSelection([foreign],own.map(w=>w.id)),undefined);
 assert.equal(rateSelection(Array.from({length:MAX_RATE_BATCH+1},(_,i)=>uuid(i+40)),[]),undefined);
 assert.equal(sameRateSelection([alice,bob],[bob,alice]),true);
 assert.equal(sameRateSelection([alice,bob],[bob,chris]),false);
});

const terms={cents:3000,effectiveOn:'2026-11-01',basis:'gross'};
const receipt=(data)=>({member_id:data.memberId,group_id:null,cents:data.cents,effective_on:data.effectiveOn,basis:data.basis});
test('10 workers at 30 and another 10 at 29 save individually and reuse independently verified receipts',async()=>{
 const a=Array.from({length:10},(_,i)=>uuid(i+10)), b=Array.from({length:10},(_,i)=>uuid(i+20));
 const called=[];
 const save=async rate=>{called.push(rate);return receipt(rate)};
 assert.equal((await storeRateSelection(a,terms,[],save)).filter(r=>r.status==='saved').length,10);
 assert.equal((await storeRateSelection(b,{...terms,cents:2900},[],save)).filter(r=>r.status==='saved').length,10);
 assert.deepEqual(called.map(v=>[v.memberId,v.cents,v.groupId]),[...a.map(id=>[id,3000,null]),...b.map(id=>[id,2900,null])]);
 const previous=called.map(receipt);
 assert.ok((await storeRateSelection(a,terms,previous,save)).every(r=>r.status==='already'));
 assert.ok((await storeRateSelection(a,{...terms,cents:2900},previous,save)).every(r=>r.status==='conflict'));
 assert.equal(called.length,20);
});

test('an unverified write never appears saved, stops subsequent writes, and returns every status',async()=>{
 const called=[];
 const result=await storeRateSelection([alice,bob,chris,foreign],terms,[],async input=>{
  called.push(input.memberId);
  if(input.memberId===bob)throw Error('conflict');
  if(input.memberId===chris)return {...receipt(input),cents:2900};
  return receipt(input);
 });
 assert.deepEqual(result,[{id:alice,status:'saved'},{id:bob,status:'conflict'},{id:chris,status:'uncertain'},{id:foreign,status:'notAttempted'}]);
 assert.deepEqual(called,[alice,bob,chris]);
});

const amounts={mode:'saved-rates',amountCents:null,knownNetCents:null,
 deductions:[{name:'PIT',cents:10000},{name:'Other actual deduction',cents:20000}],note:'Verified source'};
const line=(minutes,cents,basis='gross')=>({shiftId:uuid(minutes),date:'2026-11-03',minutes,cents,basis,rateId:uuid(500),effectiveOn:'2026-11-01',scope:'individual'});
test('100 h × 30 PLN minus 100/200 produces 2,700 PLN, actual frozen rates only and same server rounding',()=>{
 const rates=[line(6000,3000)];
 const totals=calculateDisplayedPay(6000,rates,amounts);
 assert.deepEqual(totals,{grossCents:300000,netCents:270000,deductionCents:30000});
 assert.deepEqual(paidRateSummary({...amounts,paidMinutes:6000,rateSnapshot:rates}),[{basis:'gross',cents:3000,minutes:6000}]);
 assert.deepEqual(calculateDisplayedPay(6000,[],{...amounts,mode:'gross-rate',amountCents:3000}),totals);
 assert.deepEqual(paidRateSummary({...amounts,paidMinutes:6000,mode:'gross-total',amountCents:300000,rateSnapshot:[]}),[]);
 assert.equal(completeRateSnapshot(6000,[line(5999,3000)]),false);
 assert.equal(completeRateSnapshot(6000,[line(3000,3000),line(3000,2900,'net')]),false);
 assert.equal(calculateDisplayedPay(2,[line(1,100),line(1,100)],{...amounts,deductions:[]}).grossCents,4);
 assert.equal(calculateDisplayedPay(6000,rates,{...amounts,knownNetCents:269999}),undefined);
 assert.equal(calculateDisplayedPay(6000,rates,{...amounts,deductions:[{name:'Bad',cents:300001}]}),undefined);
 for(const [text,cents] of [['29,01',2901],['30.3',3030],['10000000',1000000000],['1.001',undefined],['10000000.01',undefined],['1e3',undefined]])
  assert.equal(payslipCents(text),cents);
});

test('worker uses issued projections only, preserves manual confirmation, and new copy is localized',()=>{
 const src=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
 const page=src('hosted/PayslipsPage.tsx'),editor=src('hosted/PayslipDraftEditor.tsx'),account=src('hosted/WorkerAccountPage.tsx'),download=src('hosted/payslip-document.ts');
 assert.match(page,/c\.role!=='worker'[\s\S]*<PayslipDraftEditor/);
 assert.match(page,/c\.published\.map/);
 assert.match(account,/value\.payslips\.map[\s\S]*<PayslipAmounts value=\{p\.document\.calculation\}/);
 assert.match(editor,/confirmed:true/);
 assert.match(editor,/!unchanged\|\|!confirmed/);
 assert.match(editor,/values:PayValues/);
 assert.doesNotMatch(download,/c\.note|r\.id|sourceSha256/);
 for(const lang of ['pl','en','uk','ru']){
  const x=JSON.parse(src('i18n/locales/'+lang+'.json')).canonicalPayslips;
  for(const k of ['setRates','simpleRateHint','wholeProduction','grossRatePerHour','effectivePeriodHint','batchReport','manualDeductionHint','timecardNext','approvedHours'])assert.ok(x[k]);
  assert.equal(Object.keys(x.rateResult).length,5);
 }
});
