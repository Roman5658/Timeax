import test from 'node:test';
import assert from 'node:assert/strict';
import {zonedDateTime,elapsedShiftMinutes} from '../src/modules/workflows/domain/zoned-time.ts';
import {inputTime,shiftHours} from '../src/modules/workflows/workflow-utils.ts';

test('elapsed Warsaw time and displayed shift time are independent of machine timezone',()=>{
 const old=process.env.TZ;
 try{for(const zone of ['UTC','America/New_York','Europe/Warsaw']){
  process.env.TZ=zone;
  assert.equal(elapsedShiftMinutes('2026-10-24','22:00','06:00','Europe/Warsaw'),540);
  assert.equal(elapsedShiftMinutes('2026-10-23','22:00','06:00','Europe/Warsaw'),480);
  assert.equal(elapsedShiftMinutes('2026-03-28','22:00','06:00','Europe/Warsaw'),420);
  assert.equal(shiftHours('22:00','06:00','2026-10-24','Europe/Warsaw'),540);
  assert.equal(inputTime('2026-10-24T20:00:00Z','Europe/Warsaw'),'22:00');
 }}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('ambiguous or nonexistent DST endpoints cannot silently become another instant',()=>{
 for(const [date,time] of [['2026-10-25','02:30'],['2026-03-29','02:30'],['2026-02-30','22:00']])assert.ok(Number.isNaN(zonedDateTime(date,time,'Europe/Warsaw').getTime()));
 assert.equal(zonedDateTime('2026-10-25','03:30','Europe/Warsaw').toISOString(),'2026-10-25T02:30:00.000Z');
 assert.ok(Number.isNaN(zonedDateTime('2026-10-25','03:30','Invalid/Zone').getTime()));
});
