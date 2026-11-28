import test from 'node:test';
import assert from 'node:assert/strict';
import {agencyOverview,overviewDays,productionOverview} from '../src/hosted/agency-overview.ts';

const now=Date.parse('2026-11-28T12:00:00Z');
const local=(day,paidMinutes)=>({localDate:day,startTime:'06:00',endTime:'14:00',paidMinutes});
test('agency overview keeps the newest authorized shift, merges overlapping absences and distinguishes pending hours',()=>{
 const seed={org:'a',member:'owner',month:'2026-11',now,initialSites:[{id:'site',name:'Old site name'}],setup:{
  memberships:[{id:'owner',organizationId:'a',role:'agency_admin'}],
  worksites:[{id:'site',name:'Internal site',ownerId:'a',organizationId:'a',ownerKind:'agency'}],
  connections:[{agencyId:'b',state:'active',worksiteId:'other',worksiteName:'Other'},{agencyId:'a',state:'active',worksiteId:'factory',worksiteName:'External'}],
  assignments:[{organizationId:'a',state:'active',role:'worker',startsAt:'2026-01-01',worksiteId:'site',membershipId:'worker'},
   {organizationId:'a',state:'active',role:'worker',startsAt:'2026-01-01',endsAt:'2026-01-02',worksiteId:'site',membershipId:'former'}]},
  internal:{organizationId:'a',membershipId:'owner',role:'agency_admin',shifts:[
   {id:'s1',membershipId:'worker',worksiteId:'site',revision:1,data:local('2026-11-02',420)},
   {id:'s1',membershipId:'worker',worksiteId:'site',revision:2,data:local('2026-11-02',450)},
   {id:'s2',membershipId:'worker',worksiteId:'site',revision:1,data:local('2026-10-31',480)}]},
  factory:{organizationId:'a',membershipId:'owner',role:'agency_admin',placements:[],archive:[
   {agencyId:'b',worksiteId:'factory',snapshot:{organizationId:'b',worksiteId:'factory',rows:[{id:'leak',membershipId:'worker',revision:1,data:local('2026-11-02',480)}]}},
   {agencyId:'a',worksiteId:'factory',snapshot:{organizationId:'a',worksiteId:'factory',rows:[{id:'f',membershipId:'worker',revision:1,data:local('2026-11-03',480)}]}}]},
  team:{organizationId:'a',membershipId:'owner',role:'agency_admin',entries:[
   {id:'a1',kind:'absence',sender:'worker',state:'active',outgoing:false,payload:{dateFrom:'2026-10-30',dateTo:'2026-11-01'}},
   {id:'a2',kind:'absence',sender:'worker',state:'active',outgoing:false,payload:{dateFrom:'2026-11-01',dateTo:'2026-11-01'}},
   {id:'a3',kind:'absence',sender:'worker',state:'cancelled',outgoing:false,payload:{dateFrom:'2026-11-06',dateTo:'2026-11-06'}},
   {id:'m1',kind:'message',sender:'worker',state:'active',outgoing:false,read:false},
   {id:'m2',kind:'message',sender:'worker',state:'active',outgoing:false,read:false}],
   agencySchedule:[{state:'active',localDate:'2026-11-07',recipients:['worker']}]},
  messageStates:{'team-message-m2':'archived'},requests:[{id:'r1',workerId:'worker',state:'pending',day:'2026-11-04'}]};
 const {sites,workers,shifts}=agencyOverview(seed);
 assert.deepEqual(sites.map(s=>[s.name,[...s.workers]]),[['Internal site',['worker']],['External',[]]]);
 assert.equal(shifts.reduce((n,s)=>n+s.minutes,0),930);
 const worker=workers.get('worker');
 assert.equal(worker.messages,1);
 const {offset,days}=overviewDays(seed.month,worker);
 assert.equal(offset,6);
 assert.deepEqual(days.slice(0,8).map(d=>d.kind),['absence','shift','shift','review','empty','empty','planned','weekend']);
 assert.equal(days.filter(d=>d.absences.length).length,1);
 assert.equal(days[3].minutes,0);
 assert.equal(agencyOverview({...seed,member:'different'}).shifts.length,0);
});

test('production overview counts only its shifts and keeps transfers separate from current assignments',()=>{
 const shifts=[
  {site:'a',worker:'current',minutes:450},{site:'a',worker:'transferred',minutes:480},
  {site:'a',worker:'transferred',minutes:360},{site:'b',worker:'current',minutes:250},
  {site:'b',worker:'other',minutes:480},
 ];
 assert.deepEqual(productionOverview('a',new Set(['current','new']),shifts),{
  totalMinutes:1290,
  workers:[{id:'current',assigned:true,minutes:450,shifts:1},{id:'new',assigned:true,minutes:0,shifts:0},{id:'transferred',assigned:false,minutes:840,shifts:2}],
 });
});
