import assert from 'node:assert/strict';
import test from 'node:test';
import {workerHistoryDays,workerHistoryMonth} from '../src/hosted/worker-shift-history.ts';
const empty={shifts:[],absences:[],plans:[]};
test('worker history includes only real records for the month, newest day first',()=>{
 const shift=(id,source,date,start)=>({id,source,data:{localDate:date,startTime:start}});
 const records={
  shifts:[shift('a','internal','2026-11-11','14:00'),shift('b','factory','2026-11-11','06:00'),shift('old','internal','2026-10-31','13:00')],
  absences:[{id:'range',from:'2026-11-29',to:'2026-12-02'}],
  plans:[{id:'plan',day:'2026-11-20',start:'08:00'}],
 };
 const result=workerHistoryDays('2026-11',records);
 assert.deepEqual(result.map(r=>r.day),['2026-11-30','2026-11-29','2026-11-20','2026-11-11']);
 assert.equal(result[0].absences[0].id,'range');
 assert.equal(result[0].shifts.length,0);
 assert.equal(result[2].plans[0].id,'plan');
 assert.deepEqual(result[3].shifts.map(s=>s.id),['b','a']);
 assert.deepEqual(workerHistoryDays('2026-12',records).map(r=>r.day),['2026-12-02','2026-12-01']);
});
test('invalid month and days with no entries do not create absences',()=>{
 assert.equal(workerHistoryMonth('2026-13'),false);
 assert.equal(workerHistoryMonth('2026-1'),false);
 assert.deepEqual(workerHistoryDays('2026-01',empty),[]);
 assert.deepEqual(workerHistoryDays('2026-13',empty),[]);
});
