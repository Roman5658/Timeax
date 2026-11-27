import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveWorkerShiftAssignment} from '../src/hosted/worker-shift-assignment.ts';
import {calendarDayRecords,workerCalendarRecords} from '../src/hosted/worker-calendar-data.ts';

const scope={organizationId:'agency',membershipId:'worker',role:'worker'};
const emptyInternal={...scope,worksites:[]};
const emptyFactory={...scope,assignments:[],sites:[]};
const data={...scope,internal:emptyInternal,factory:emptyFactory,internalKnown:true,factoryKnown:true};
const internal=(manualEntry,id='internal')=>({...emptyInternal,worksites:[{id,manualEntry}]});
const factory=(mode,membershipId='worker',agencyId='agency',id='factory')=>({...emptyFactory,
 sites:[{id,mode}],assignments:[{membershipId,agencyId,worksiteId:id}]});
test('only an explicit internal manual mode opens the worker form',()=>{
 assert.deepEqual(resolveWorkerShiftAssignment({...data,internal:internal(true)}),{state:'ready',source:'internal'});
 for(const value of [false,undefined])assert.equal(resolveWorkerShiftAssignment({...data,internal:internal(value)}).state,'disabled');
 assert.equal(resolveWorkerShiftAssignment({...data}).state,'unassigned');
});
test('only an exact factory assignment in self entry mode opens the worker form',()=>{
 assert.deepEqual(resolveWorkerShiftAssignment({...data,factory:factory('self')}),{state:'ready',source:'factory'});
 assert.equal(resolveWorkerShiftAssignment({...data,factory:factory('attendance')}).state,'disabled');
 assert.equal(resolveWorkerShiftAssignment({...data,factory:factory('self','someone-else')}).state,'unassigned');
 assert.equal(resolveWorkerShiftAssignment({...data,factory:factory('self','worker','other-agency')}).state,'unassigned');
});
test('never guess a site with competing assignments or a missing read',()=>{
 assert.equal(resolveWorkerShiftAssignment({...data,internal:internal(true),factory:factory('attendance')}).state,'multiple');
 assert.equal(resolveWorkerShiftAssignment({...data,internal:internal(true),factoryKnown:false}).state,'unknown');
 assert.equal(resolveWorkerShiftAssignment({...data,internal:{...internal(true),membershipId:'other'}}).state,'unknown');
 assert.equal(resolveWorkerShiftAssignment({...data,internal:internal(true),factory:factory('self','worker','agency','internal')}).state,'unknown');
});

test('planned-only days, recorded hours, and reported absences remain separate',()=>{
 const records=workerCalendarRecords({...scope,internal:{...emptyInternal,shifts:[{id:'shift',membershipId:'worker',state:'recorded',data:{localDate:'2026-11-01',startTime:'06:00',endTime:'14:00',paidMinutes:480}}]},team:{...scope,sites:[],entries:[
  {id:'plan',kind:'schedule',state:'active',outgoing:false,payload:{localDate:'2026-11-02',startTime:'08:00',endTime:'16:00'}},
  {id:'reported',sender:'worker',kind:'absence',state:'active',outgoing:true,payload:{dateFrom:'2026-11-03',dateTo:'2026-11-03'}},
  {id:'cancelled-plan',kind:'schedule',state:'cancelled',outgoing:false,payload:{localDate:'2026-11-04',startTime:'08:00',endTime:'16:00'}},
 ]}});
 assert.deepEqual(['01','02','03','04'].map(n=>{const d=calendarDayRecords('2026-11-'+n,records);return [d.shifts.length,d.plans.length,d.absences.length]}),[[1,0,0],[0,1,0],[0,0,1],[0,0,0]]);
});
