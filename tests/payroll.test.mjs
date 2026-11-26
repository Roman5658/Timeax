import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, defaultPayrollContext, payrollHours } from '../src/modules/payroll/domain/payroll.ts';
import { createSeedWorkspace } from '../src/modules/workflows/demo-data.ts';

const input = {dayHours:160,nightHours:20,dayRate:24,nightRate:30,additions:100,deductions:500,note:'Manual demo deductions',context:{...defaultPayrollContext}};
test('day and night earnings use separate rates, additions and explicit deductions',()=>{
  assert.deepEqual(calculatePayroll(input), {gross:4540,net:4040});
  assert.equal(calculatePayroll({...input,nightRate:40}).net,4240);
  assert.equal(calculatePayroll({...input,context:{...defaultPayrollContext,contract:'employment',under26:'yes',student:'yes'}}).net,4040,'contract flags must not invent taxes or exemptions');
});
test('invalid payroll values and negative net are rejected',()=>{
  for(const patch of [{dayHours:-1},{dayRate:NaN},{nightRate:Infinity},{dayHours:744,nightHours:1},{deductions:999999},{dayRate:10001}]) assert.equal(calculatePayroll({...input,...patch}),undefined);
  assert.deepEqual(calculatePayroll({...input,dayHours:0,nightHours:0,additions:0,deductions:0}),{gross:0,net:0});
});
test('money is rounded to grosz, hours do not become currency',()=>{
  assert.deepEqual(calculatePayroll({...input,dayHours:1/3,nightHours:0,dayRate:24,additions:0.01,deductions:0.01}),{gross:8.01,net:8});
});

async function isolated(name, action) {
  const workspace=structuredClone(createSeedWorkspace({includeFeatureFixtures:true}));
  if(name === "leader") { const factory=workspace.factories.find(f=>f.id==="factory-alpha"); workspace.worksites.find(site=>site.id===factory.worksiteId).businessEntityId="qa-connected-factory"; }
  const raw=JSON.stringify(workspace);
  const saved=new Map([['timeax-demo-workspace-v1',raw]]);
  globalThis.window={localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},addEventListener(){},removeEventListener(){}};
  try { const store=await import(`../src/modules/workflows/demo-store.ts?payroll-${name}`); await action(store,()=>JSON.parse(saved.get('timeax-demo-workspace-v1')),saved,raw); }
  finally {delete globalThis.window;}
}
test('issuance is opt-in, scoped, immutable and visible only to agency and matching worker',async()=>isolated('issue',(s,state)=>{
  s.setActiveMember('agency-demo');
  assert.equal(s.issueDemoPayslip('worker-01','2026-11',input),false);
  assert.equal(s.savePayrollSettings({dayRate:24,nightRate:30,issueEnabled:true,context:defaultPayrollContext}),true);
  assert.equal(s.issueDemoPayslip('worker-partner-02','2026-11',input),false);
  assert.equal(s.issueDemoPayslip('worker-01','2026-13',input),false);
  assert.equal(s.issueDemoPayslip('worker-01','2026-11',{...input,note:''}),false);
  assert.equal(s.issueDemoPayslip('worker-01','2026-11',input),true);
  assert.equal(s.issueDemoPayslip('worker-01','2026-11',input),false);
  s.setActiveMember('leader-01'); assert.equal(s.getVisiblePayslips(state()).length,0);
  assert.equal(s.savePayrollSettings({dayRate:1,nightRate:1,issueEnabled:true}),false);
  s.setActiveMember('worker-02'); assert.equal(s.getVisiblePayslips(state()).length,0);
  s.setActiveMember('worker-01'); assert.equal(s.getVisiblePayslips(state())[0].net,4040);
}));
test('personal rates do not overwrite agency settings or another workers rates',async()=>isolated('personal',(s,state)=>{
  s.setActiveMember('agency-demo'); s.savePayrollSettings({dayRate:40,nightRate:50,issueEnabled:false});
  s.setActiveMember('worker-01');
  assert.equal(s.savePersonalPayrollSettings('worker-01',{dayRate:24,nightRate:32,issueEnabled:false,context:defaultPayrollContext}),true);
  assert.equal(s.savePersonalPayrollSettings('worker-02',{dayRate:1,nightRate:1,issueEnabled:false}),false);
  assert.equal(state().payrollSettings['org-demo-01'].dayRate,40);
  assert.equal(state().personalPayrollSettings['worker-01'].nightRate,32);
}));
test('original browser state is backed up byte-for-byte and never overwritten',async()=>isolated('backup',(s,state,saved,raw)=>{
  s.setActiveMember('agency-demo'); s.savePayrollSettings({dayRate:24,nightRate:30,issueEnabled:true});
  assert.equal(saved.get('timeax-demo-workspace-v1-backup-before-payroll-v1'),raw);
  s.setActiveMember('worker-01');
  assert.equal(saved.get('timeax-demo-workspace-v1-backup-before-payroll-v1'),raw);
}));
test('leader decisions override legacy A/B modes and agency cannot change input mode',async()=>isolated('leader',(s,state)=>{
  s.setActiveMember('agency-demo'); assert.equal(s.setFactoryInputMode('factory-alpha','B'),false);
  assert.equal(s.setWorkerInputAccess('factory-alpha','worker-01','leader'),false);
  s.setActiveMember('leader-01');
  assert.equal(s.setWorkerInputAccess('factory-alpha','worker-01','leader'),true);
  assert.equal(s.getWorkerAccess(state(),'worker-01','factory-alpha'),'leader');
  assert.equal(s.setWorkerInputAccess('factory-alpha','worker-01','self'),true);
  assert.equal(s.getWorkerAccess(state(),'worker-01','factory-alpha'),'self');
  assert.equal(s.setLeaderWorkerInputAccess('leader-01','worker-partner-02','self'),false);
}));
test('agency records own workplace hours, duplicates rejected, worker confirmation required',async()=>isolated('entry',(s,state)=>{
  s.setActiveMember('agency-demo');
  const period=state().employmentPeriods.find(p=>p.workerId==='worker-01'&&p.state==='active');
  const draft={factoryId:'factory-alpha',localDate:period.startDate,startTime:'02:00',endTime:'03:00',comment:'',breakStatus:'not-taken',breakTreatment:'unpaid',breakDurationMinutes:0};
  assert.equal(s.createAgencyShift('worker-01',draft),true);
  assert.equal(s.createAgencyShift('worker-01',draft),false);
  const record=state().shifts.find(r=>r.shift.source==='agency-admin'&&r.shift.workerUid==='worker-01');
  assert.equal(record.shift.workerConfirmation,'pending');
  s.setActiveMember('worker-01'); assert.equal(s.confirmShift(record.shift.id),true);
}));
test('timesheet import separates actual day/night hours and excludes deleted records',()=>{
  const workspace=structuredClone(createSeedWorkspace({includeFeatureFixtures:true}));
  const record=workspace.shifts.find(r=>r.shift.workerUid==='worker-01');
  assert.ok(record);
  workspace.shifts=[{...record,shift:{...record.shift,startAt:'2026-11-12T21:00:00Z',endAt:'2026-11-13T05:00:00Z',localStartDate:'2026-11-12',timeZone:'Europe/Warsaw',paidDurationMinutes:480,grossDurationMinutes:480,unpaidBreakDurationMinutes:0,actualBreak:{...record.shift.actualBreak,segments:[]}}}];
  const result=payrollHours(workspace,'worker-01','2026-11');
  assert.equal(result.dayHours,0); assert.equal(result.nightHours,8);
  workspace.shifts[0].shift.deletedAt=new Date().toISOString();
  assert.equal(payrollHours(workspace,'worker-01','2026-11').nightHours,0);
});

function freeDay(workspace) {
  const period=workspace.employmentPeriods.find(item=>item.workerId==='worker-01'&&item.state==='active');
  for(let i=0;i<60;i++) {
    const date=new Date(period.startDate+'T12:00:00'); date.setDate(date.getDate()+i);
    const value=date.toISOString().slice(0,10);
    if(!workspace.shifts.some(item=>item.shift.workerUid==='worker-01'&&item.shift.localStartDate===value)
      && !workspace.absences.some(item=>item.workerId==='worker-01'&&item.localDate===value)) return value;
  }
  assert.fail('No free test date');
}
test('agency no-show can become agreed day off, preserving history and no payroll deductions',async()=>isolated('absence',(s,state)=>{
  s.setActiveMember('agency-demo'); const day=freeDay(state());
  assert.equal(s.recordAgencyAbsence('worker-01','factory-alpha',day,'unreported','No arrival; awaiting explanation'),true);
  assert.equal(s.recordAgencyAbsence('worker-01','factory-alpha',day,'unreported','Duplicate'),false);
  let record=state().absences.find(item=>item.workerId==='worker-01'&&item.localDate===day);
  assert.equal(record.agencyCategory,'unreported');
  const initialHistory=record.history.length;
  assert.equal(s.classifyRecordedAbsence(record.id,'agreed-day-off','Agreed with the worker'),true);
  record=state().absences.find(item=>item.id===record.id);
  assert.equal(record.agencyCategory,'agreed-day-off'); assert.equal(record.reason,'day-off'); assert.equal(record.state,'reviewed');
  assert.equal(record.history.length,initialHistory+1); assert.equal(record.history[0].action,'marked-unreported');
  assert.equal(state().payslips?.length??0,0);
  s.setActiveMember('worker-01'); assert.equal(s.classifyRecordedAbsence(record.id,'unreported','Not allowed'),false);
}));
test('leader can distinguish no-show from agreed day off for their worker',async()=>isolated('leader-absence',(s,state)=>{
  s.setActiveMember('leader-01'); const day=freeDay(state());
  assert.equal(s.markUnreportedAbsence('worker-01',day,'Absent at the shift'),true);
  const record=state().absences.find(item=>item.workerId==='worker-01'&&item.localDate===day);
  assert.equal(s.classifyRecordedAbsence(record.id,'agreed-day-off','Excused and agreed'),true);
  assert.equal(state().absences.find(item=>item.id===record.id).agencyCategory,'agreed-day-off');
  s.setActiveMember('agency-partner'); assert.equal(s.classifyRecordedAbsence(record.id,'unreported','Wrong agency'),false);
}));


test('internal agency workplaces keep worker self entry despite old leader settings',async()=>isolated('internal',(s,state)=>{
 const w=state();const factory=w.factories.find(f=>f.id==='factory-alpha');factory.inputMode='B';factory.workerAccess['worker-01']='leader';
 assert.equal(s.isInternalAgencyFactory(w,factory.id),true);
 assert.equal(s.getWorkerAccess(w,'worker-01',factory.id),'self');
}));
