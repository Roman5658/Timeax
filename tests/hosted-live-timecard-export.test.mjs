import assert from 'node:assert/strict';
import test from 'node:test';
import {liveTimekeepingReport,snapshotExportRows} from '../src/hosted/timecard-document.ts';
import {scopedReportedAbsences} from '../src/hosted/live-timecard-absences.ts';
import {timecardFileName} from '../src/hosted/timecard-xlsx.ts';
const org='agency',site='factory',member='worker',actor='admin';
const entry={id:'absence',kind:'absence',state:'active',sender:member,siteId:site,outgoing:false,payload:{dateFrom:'2026-11-05',dateTo:'2026-11-10'}};
const bounds={from:'2026-11-06',to:'2026-11-09'},scope={organizationId:org,membershipId:actor,role:'agency_admin',timeZone:'Europe/Warsaw',shifts:[]};
const filters={organizationId:org,membershipId:actor,site,worker:'',bounds,days:[1,2,3,4,5],search:'',label:x=>x,language:'en'};
const comm={...scope,sites:[{id:site,name:'Site'}],recipients:[{role:'worker',organizationId:org,id:member},{role:'worker',organizationId:'foreign',id:'other'}],
 entries:[entry,entry,{...entry,id:'cancel',state:'cancelled'},{...entry,id:'foreign',sender:'other'},{...entry,id:'bad',payload:{dateFrom:'xxxxx',dateTo:'123'}}]};
test('one active absence report clipped to selected dates and weekdays, never inferred from missing shifts',()=>{
 assert.equal(scopedReportedAbsences({...comm,membershipId:'foreign'},filters),undefined);
 assert.equal(scopedReportedAbsences(undefined,filters),undefined);
 const matches=scopedReportedAbsences(comm,filters);
 assert.equal(matches.length,1);
 assert.deepEqual(matches[0].ranges,[{from:'2026-11-06',to:'2026-11-06'},{from:'2026-11-09',to:'2026-11-09'}]);
 assert.equal(scopedReportedAbsences(comm,{...filters,days:[]}).length,0);
 assert.equal(scopedReportedAbsences(comm,{...filters,worker:'not-a-member'}).length,0);
 assert.equal(scopedReportedAbsences(comm,{...filters,site:'other-site'}).length,0);
 const report=liveTimekeepingReport(scope,[],bounds,'All',()=>undefined,matches);
 assert.equal(report.status,'preview');assert.equal(report.rows.length,0);assert.equal(report.absences.length,1);
 assert.equal(snapshotExportRows(report,member).paidMinutes,0);assert.match(timecardFileName(report),/^Timeax-preview-/);
});
test('preview includes exactly the selected real rows, preserves states and worksite names, and is never archived',()=>{
 const row={id:'shift',membershipId:member,worksiteId:site,worksiteName:'Site A',revision:2,state:'recorded',
  data:{localDate:'2026-11-06',startTime:'08:00',endTime:'16:00',grossMinutes:480,breakMinutes:30,paidMinutes:450}};
 const other={...row,id:'other-shift',membershipId:'other-worker',worksiteName:'Site B'};
 const candidate={...row,id:'not-from-server'};
 const report=liveTimekeepingReport({...scope,shifts:[row,other]},[{id:member,rows:[row,row,candidate,other]}],bounds,'All',()=>undefined);
 assert.equal(report.source,'internal-live');assert.equal(report.status,'preview');assert.equal(report.paidMinutes,450);
 assert.deepEqual(report.rows.map(r=>[r.id,r.worksiteName,r.liveState]),[['shift','Site A','recorded']]);
 assert.equal(report.absences,undefined);assert.equal(snapshotExportRows(report).rows.length,1);
});
