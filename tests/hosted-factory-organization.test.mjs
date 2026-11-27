import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseFactoryRoster,parseFactorySchedule,validFactoryPeriod} from '../src/hosted/factory-organization.ts';

const id=n=>'00000000-0000-4000-8000-00000000000'+n;
const scope={organizationId:id(1),membershipId:id(2),worksiteId:id(3)},worker=id(4),lead=id(5),department=id(6),group=id(7);
const dept={id:department,kind:'department',name:'Packing',revision:1,workers:[worker],departmentId:null,leaderId:null};
const team={id:group,kind:'group',name:'Morning',revision:2,workers:[worker],departmentId:department,leaderId:lead};
const roster={...scope,members:[worker],leaders:[lead],units:[dept,team]};
test('factory roster validates workspace, metadata membership and parent branch',()=>{
 assert.equal(parseFactoryRoster(roster,scope).units.length,2);
 assert.throws(()=>parseFactoryRoster({...roster,worksiteId:id(8)},scope));
 assert.throws(()=>parseFactoryRoster({...roster,units:[dept,{...team,workers:[id(8)]}]},scope));
 assert.throws(()=>parseFactoryRoster({...roster,units:[dept,{...team,departmentId:group}]},scope));
 assert.throws(()=>parseFactoryRoster({...roster,leaders:[]},scope));
});
test('factory read-only schedule validates actual dates, times and references',()=>{
 const from='2026-11-01',to='2026-11-30';
 const plan={id:id(9),membershipId:worker,localDate:'2026-11-13',startTime:'22:00',endTime:'06:00',state:'active'};
 assert.equal(validFactoryPeriod(from,to),true);
 assert.equal(validFactoryPeriod('2026-11-31','2026-12-15'),false);
 assert.equal(validFactoryPeriod(from,'2026-12-03'),false);
 assert.deepEqual(parseFactorySchedule({...scope,plans:[plan]},scope,from,to),{rows:[plan],overflow:false});
 assert.throws(()=>parseFactorySchedule({...scope,plans:[plan,plan]},scope,from,to));
 assert.throws(()=>parseFactorySchedule({...scope,plans:[{...plan,localDate:'2026-12-15'}]},scope,from,to));
 assert.throws(()=>parseFactorySchedule({...scope,plans:[{...plan,startTime:'24:00'}]},scope,from,to));
});
