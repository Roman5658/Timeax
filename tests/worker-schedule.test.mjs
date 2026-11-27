import test from 'node:test';
import assert from 'node:assert/strict';
import {workerScheduleRows} from '../src/hosted/worker-schedule.ts';

test('worker schedule lists only valid received plans, ordered by date and time',()=>{
 const plan=(id,localDate,startTime,endTime,more={})=>({id,kind:'schedule',state:'active',outgoing:false,payload:{localDate,startTime,endTime},...more});
 const rows=workerScheduleRows([
  plan('old','2026-11-27','06:00','14:00'),
  plan('late','2026-11-28','14:00','22:00',{state:'cancelled'}),
  plan('early','2026-11-28','06:00','14:00'),
  plan('other','2026-11-29','06:00','14:00',{kind:'absence'}),
  plan('bad','2026-02-31','06:00','14:00'),
  plan('private','2026-11-30','06:00','14:00',{outgoing:true})
 ]);
 assert.deepEqual(rows.map(row=>[row.id,row.cancelled]),[['early',false],['late',true],['old',false]]);
});
