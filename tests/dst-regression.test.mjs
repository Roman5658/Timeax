import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import i18next from 'i18next';
import {createSeedWorkspace} from '../src/modules/workflows/demo-data.ts';
import {buildMonthlyTimesheetSnapshot} from '../src/modules/monthly-timesheets/domain/timesheet.ts';
import {payrollHours,calculatePayroll} from '../src/modules/payroll/domain/payroll.ts';

test('Warsaw autumn 2026 night is nine elapsed hours; breaks and manually chosen night rate remain separate',async()=>{
 const oldTZ=process.env.TZ;process.env.TZ='UTC';
 const w=createSeedWorkspace({includeFeatureFixtures:true});w.shifts=[];w.absences=[];
 for(const p of w.employmentPeriods.filter(p=>p.workerId==='worker-01')){p.startDate='2026-01-01';p.endDate=undefined;p.state='active';for(const a of p.placements){a.startDate='2026-01-01';a.endDate=undefined;}}
 const saved=new Map([['timeax-demo-workspace-v1',JSON.stringify(w)]]);
 globalThis.window={localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},addEventListener(){},removeEventListener(){}};
 try{
  const s=await import('../src/modules/workflows/demo-store.ts?dst-regression');s.setActiveMember('agency-demo');
  const draft={factoryId:'factory-alpha',startTime:'22:00',endTime:'06:00',comment:'DST QA',breakStatus:'not-taken',breakTreatment:'unpaid',breakDurationMinutes:0};
  assert.equal(s.createAgencyShift('worker-01',{...draft,localDate:'2026-10-24'}),true);
  assert.equal(s.createAgencyShift('worker-01',{...draft,localDate:'2026-10-23'}),true);
  let state=JSON.parse(saved.get('timeax-demo-workspace-v1'));
  const dst=state.shifts.find(x=>x.shift.localStartDate==='2026-10-24').shift;
  const normal=state.shifts.find(x=>x.shift.localStartDate==='2026-10-23').shift;
  assert.equal(dst.startAt,'2026-10-24T20:00:00.000Z');assert.equal(dst.endAt,'2026-10-25T05:00:00.000Z');
  assert.equal(dst.grossDurationMinutes,540);assert.equal(dst.paidDurationMinutes,540);assert.equal(normal.grossDurationMinutes,480);
  for(const [name,paid,minutes] of [['unpaid',510,510],['paid',540,540]]){
   const record=state.shifts.find(x=>x.shift.id===dst.id);
   const shift={...dst,totalBreakDurationMinutes:30,unpaidBreakDurationMinutes:name==='unpaid'?30:0,paidDurationMinutes:paid,actualBreak:{...dst.actualBreak,status:'taken',treatment:name,segments:[{startAt:'2026-10-25T03:00:00Z',endAt:'2026-10-25T03:30:00Z',durationMinutes:30,treatment:name}]}};
   const scoped={...state,shifts:[{...record,shift}]};
   const row=buildMonthlyTimesheetSnapshot(scoped,'factory-alpha','2026-10','agency').rows.find(r=>r.kind==='shift');
   assert.equal(row.grossDurationMinutes,540);assert.equal(row.paidDurationMinutes,paid);assert.equal(row.nightDurationMinutes,minutes);
   const hours=payrollHours(scoped,'worker-01','2026-10');assert.equal(hours.dayHours,0);assert.equal(hours.nightHours,paid/60);
   const calc={...hours,dayRate:24,nightRate:30,additions:0,deductions:0,note:'Chosen demo rate, no statutory premium'};
   assert.equal(calculatePayroll(calc).net,paid/60*30);
   assert.equal(calculatePayroll({...calc,nightRate:24}).net,paid/60*24,'night hours must not invent a legal premium');
  }
  s.setActiveMember('agency-demo');
  assert.equal(s.recordAgencyAbsence('worker-01','factory-alpha','2026-10-21','unreported','No arrival'),true);
  assert.equal(s.recordAgencyAbsence('worker-01','factory-alpha','2026-10-22','agreed-day-off','Agreed with worker'),true);
  state=JSON.parse(saved.get('timeax-demo-workspace-v1'));
  const rows=buildMonthlyTimesheetSnapshot(state,'factory-alpha','2026-10','agency').rows.filter(r=>r.kind==='absence');
  assert.deepEqual(rows.map(r=>r.absenceCategory),['unreported','agreed-day-off']);
  assert.deepEqual(rows.map(r=>r.comment),['No arrival','Agreed with worker']);
  assert.ok(rows.every(r=>r.paidDurationMinutes===0&&r.grossDurationMinutes===0));
  assert.equal(payrollHours(state,'worker-01','2026-10').nightHours,17,'absence categories do not add hours or deduct earnings');
  assert.equal(state.payslips?.length??0,0);
 }finally{delete globalThis.window;if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;}
});

test('payroll heading resolves through i18next in all four languages',async()=>{
 const expected={pl:'Kalkulacja wynagrodzenia',en:'Payroll estimate',ru:'Расчёт зарплаты',uk:'Розрахунок зарплати'};
 for(const [lng,title] of Object.entries(expected)){
  const translation=JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lng}.json`,import.meta.url),'utf8'));
  const i=i18next.createInstance();await i.init({lng,resources:{[lng]:{translation}},fallbackLng:false});
  assert.equal(i.t('payroll.agencyTitle'),title);assert.notEqual(i.t('payroll.workerTitle'),'payroll.workerTitle');
 }
});
