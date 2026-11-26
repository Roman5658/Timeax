import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedWorkspace } from '../src/modules/workflows/demo-data.ts';

test('first workplace assignment preserves employment and permits agency entry without a leader', async () => {
  const saved = new Map([['timeax-demo-workspace-v1', JSON.stringify(createSeedWorkspace())]]);
  globalThis.window = {localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},addEventListener(){},removeEventListener(){}};
  const state=()=>JSON.parse(saved.get('timeax-demo-workspace-v1'));
  try {
    const s=await import('../src/modules/workflows/demo-store.ts?first-assignment');
    const worker=s.createAgencyWorker('QA unassigned','','');
    assert.ok(worker);
    const now=new Date(); const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    assert.equal(s.hireWorker(worker.id,undefined,undefined,today),true);
    const period=state().employmentPeriods.find(p=>p.workerId===worker.id);
    assert.equal(period.placements.length,0);
    const site=s.createAgencyWorkplace({worksiteName:'Internal QA',address:'Synthetic QA address',productionName:'Direct agency team'});
    assert.ok(site);
    assert.equal(s.createAgencyShift(worker.id,{factoryId:site.factory.id,localDate:period.startDate,startTime:'06:00',endTime:'14:00',comment:'',breakStatus:'not-taken',breakTreatment:'unpaid',breakDurationMinutes:0}),false);
    assert.equal(s.assignWorkerToProduction(site.factory.id,worker.id,true),true);
    const after=state().employmentPeriods.filter(p=>p.workerId===worker.id);
    assert.equal(after.length,1); assert.equal(after[0].id,period.id); assert.equal(after[0].placements.length,1);
    assert.equal(after[0].placements[0].leaderId,undefined);
    assert.equal(s.createAgencyShift(worker.id,{factoryId:site.factory.id,localDate:period.startDate,startTime:'06:00',endTime:'14:00',comment:'',breakStatus:'not-taken',breakTreatment:'unpaid',breakDurationMinutes:0}),true);
    const shift=state().shifts.find(r=>r.shift.workerUid===worker.id).shift;
    assert.equal(shift.paidDurationMinutes,480); assert.equal(shift.workerConfirmation,'pending');
    s.setActiveMember(worker.id); assert.equal(s.confirmShift(shift.id),true);
    assert.equal(state().shifts.find(r=>r.shift.id===shift.id).shift.workerConfirmation,'confirmed');
    assert.equal(s.assignWorkerToProduction(site.factory.id,worker.id,false),false);
  } finally {delete globalThis.window;}
});
