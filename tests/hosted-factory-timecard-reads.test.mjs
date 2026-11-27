import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseFactoryHours,factorySnapshotCsv} from '../src/hosted/factory-timecards.ts';

const id=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const factory=id(1), site=id(2), agency=id(3), admin=id(4), worker=id(5), shiftId=id(6), sheetId=id(7), unrelated=id(8);
const day='2026-11-27';
function context(){
 const data={localDate:day,paidMinutes:480},snapshot={version:1,source:'connected-factory',status:'received',timeZone:'Europe/Warsaw',factoryId:factory,worksiteId:site,organizationId:agency,dateFrom:day,dateTo:day,paidMinutes:480,rows:[{id:shiftId,membershipId:worker,data,state:'ready'}]};
 return {factoryAdminRead:true,organizationId:factory,membershipId:admin,role:'factory_admin',sites:[{id:site,factoryId:factory,name:'Owned site',mode:'attendance',modeRevision:1}],agencies:[],workers:[],assignments:[],placements:[],
 shifts:[{id:shiftId,worksite_id:site,agency_id:agency,membership_id:worker,source:'attendance',state:'ready',revision:1,data}],
 archive:[{id:sheetId,worksiteId:site,agencyId:agency,dateFrom:day,dateTo:day,snapshot}]};
}
test('factory admin hours require explicit read capability and the exact owned site and archived sender/recipient',()=>{
 const current=context();
 assert.equal(parseFactoryHours(current,factory),current);
 assert.match(factorySnapshotCsv(current.archive[0].snapshot,'sent'),/Timeax sent factory timecard/);
 for(const tamper of [c=>delete c.factoryAdminRead,c=>c.sites[0].factoryId=unrelated,c=>c.shifts[0].worksite_id=unrelated,c=>c.archive[0].snapshot.factoryId=unrelated,c=>c.archive[0].snapshot.organizationId=unrelated,c=>c.archive[0].dateTo='2026-11-28']){
  const bad=context();tamper(bad);assert.throws(()=>parseFactoryHours(bad,factory),/unavailable/);
 }
 const old=context();delete old.factoryAdminRead;old.shifts=[];old.archive=[];
 assert.equal(parseFactoryHours(old,factory).factoryAdminRead,undefined);
});
