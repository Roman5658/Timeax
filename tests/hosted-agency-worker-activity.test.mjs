import assert from 'node:assert/strict';
import {test} from 'node:test';
import {selectInternalWorkerShifts,selectReceivedWorkerShifts,selectWorkerAbsences} from '../src/hosted/agency-worker-activity.ts';
const id=n=>'11000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [organizationId,admin,membershipId,other,siteId,otherSite,otherAgency,factory]=Array.from({length:8},(_,i)=>id(i+1));
const scope={organizationId,membershipId},date='2026-11-24';
const data=(paidMinutes,localDate=date)=>({localDate,paidMinutes,grossMinutes:480,startTime:'06:00',endTime:'14:00',comment:'',timeZone:'Europe/Warsaw'});
const internal=(n,member,site,minutes)=>({id:id(n),membershipId:member,worksiteId:site,worksiteName:'Site '+site.slice(-1),revision:1,state:'recorded',data:data(minutes)});
const context={organizationId,membershipId:admin,role:'agency_admin'};
const timecards={...context,timeZone:'Europe/Warsaw',worksites:[],archive:[],shifts:[internal(10,membershipId,siteId,450),internal(11,other,siteId,150),internal(12,membershipId,otherSite,300)]};
test('worker card internal hours use exact membership and optional site',()=>{
 assert.deepEqual(selectInternalWorkerShifts(timecards,scope).map(x=>x.data.paidMinutes),[450,300]);
 assert.deepEqual(selectInternalWorkerShifts(timecards,{...scope,siteId}).map(x=>x.data.paidMinutes),[450]);
 assert.throws(()=>selectInternalWorkerShifts(timecards,{...scope,organizationId:otherAgency}),/unavailable/);
 assert.deepEqual(selectInternalWorkerShifts(timecards,{...scope,membershipId:id(99)}),[]);
});
function archive(n,agency,site,rows){
 return {id:id(n),agencyId:agency,worksiteId:site,snapshot:{organizationId,version:1,source:'connected-factory',status:'received',timeZone:'Europe/Warsaw',
  factoryId:factory,worksiteId:site,worksiteName:'Sent site',rows,paidMinutes:rows.reduce((n,r)=>n+r.data.paidMinutes,0)}};
}
const received=(n,member,revision,minutes)=>({id:id(n),membershipId:member,revision,state:'ready',data:data(minutes)});
test('factory hours come only from received tables for this agency and deduplicate repeated shift revisions',()=>{
 const factoryContext={...context,sites:[],agencies:[],workers:[],assignments:[],placements:[],shifts:[],archive:[
  archive(20,organizationId,siteId,[received(21,other,1,99),received(22,membershipId,1,480)]),
  archive(23,organizationId,siteId,[received(22,membershipId,2,450)]),
  archive(24,otherAgency,siteId,[received(25,membershipId,1,70)]),
  archive(26,organizationId,otherSite,[received(27,membershipId,1,370)]),
 ]};
 assert.deepEqual(selectReceivedWorkerShifts(factoryContext,{...scope,siteId}).map(x=>x.data.paidMinutes),[450]);
 assert.deepEqual(selectReceivedWorkerShifts(factoryContext,scope).map(x=>x.data.paidMinutes),[450,370]);
});
const entry=(n,sender,extra={})=>({id:id(n),kind:'absence',sender,outgoing:false,state:'active',siteId,payload:{dateFrom:date,dateTo:'2026-11-26'},...extra});
test('absences are reports not guesses from hours, excluding messages and other workers',()=>{
 const workflow={...context,sites:[{id:siteId,name:'Site'}],entries:[
  entry(30,membershipId),entry(31,other),entry(32,membershipId,{kind:'message'}),
  entry(33,membershipId,{outgoing:true}),entry(34,membershipId,{state:'cancelled',siteId:otherSite}),
 ]};
 assert.deepEqual(selectWorkerAbsences(workflow,scope).map(x=>[x.id,x.state]),[[id(30),'active'],[id(34),'cancelled']]);
 assert.deepEqual(selectWorkerAbsences(workflow,{...scope,siteId}),[{id:id(30),siteName:'Site',dateFrom:date,dateTo:'2026-11-26',state:'active'}]);
 assert.throws(()=>selectWorkerAbsences({...workflow,role:'team_leader'},scope),/denied/);
});
