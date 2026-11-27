import test from 'node:test';
import assert from 'node:assert/strict';
import {agencyPeriodToday,agencyPeriodBounds,agencyPeriodMatches,agencyPeriodOverlaps,agencyShiftGroups,weekdays} from '../src/hosted/agency-hours-scope.ts';

test('agency filters use Warsaw calendar days, real date bounds, and closed-period overlap',()=>{
 const p=agencyPeriodToday(new Date('2026-03-31T22:30:00Z'));
 assert.equal(p.date,'2026-04-01');
 assert.deepEqual(agencyPeriodBounds({...p,month:'2024-02'}),{from:'2024-02-01',to:'2024-02-29'});
 assert.equal(agencyPeriodBounds({...p,kind:'date',date:'2026-02-29'}),undefined);
 assert.equal(agencyPeriodBounds({...p,kind:'date-range',from:'2026-06-10',to:'2026-06-01'}),undefined);
 const july=agencyPeriodBounds({...p,month:'2026-07'});
 assert.equal(agencyPeriodMatches('2026-07-01',july),true);
 assert.equal(agencyPeriodMatches('2026-06-30',july),false);
 assert.equal(agencyPeriodOverlaps('2026-06-29','2026-07-02',july),true);
 assert.equal(agencyPeriodOverlaps('2026-06-29','2026-06-30',july),false);
 assert.equal(agencyPeriodMatches('2025-01-01',agencyPeriodBounds({...p,kind:'all'})),true);
});

test('agency worker paid-hours summaries honor site, search, individual filter, and weekdays without mutating source',()=>{
 const shift=(id,member,site,localDate,paidMinutes)=>({id,membershipId:member,worksiteId:site,data:{localDate,startTime:'08:00',paidMinutes}});
 const rows=[shift('t','anna','a','2026-11-24',120),shift('m','anna','a','2026-11-23',180),shift('c','anna','b','2026-11-23',300),shift('d','karol','a','2026-11-23',360)];
 const opts={site:'a',bounds:null,days:weekdays,search:'',worker:'',label:n=>({anna:'Anna Żak',karol:'Karol Nowak'})[n],locale:'pl'};
 assert.deepEqual(agencyShiftGroups(rows,opts).map(g=>[g.id,g.paidMinutes,g.rows.map(r=>r.id)]),[['anna',300,['t','m']],['karol',360,['d']]]);
 assert.deepEqual(agencyShiftGroups(rows,{...opts,search:'ŻAK',days:[1]}).map(g=>[g.id,g.paidMinutes]),[['anna',180]]);
 assert.deepEqual(agencyShiftGroups(rows,{...opts,days:[]}),[]);
 assert.deepEqual(agencyShiftGroups(rows,{...opts,worker:'karol'}).map(g=>g.id),['karol']);
 assert.deepEqual(rows.map(r=>r.id),['t','m','c','d']);
});
