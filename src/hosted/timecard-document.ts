import type {Snapshot,ShiftData} from './timecards.ts';
import type {FactorySnapshot} from './factory-timecards.ts';
import {workerLabelText} from './member-label.ts';

export type AgencyTimecardSnapshot=Snapshot|FactorySnapshot;
type Row=Snapshot['rows'][number];
export type TimecardTotals={shiftCount:number;grossMinutes:number;breakMinutes:number;paidMinutes:number};
export const timecardRowOrder=(a:Row,b:Row)=>a.data.localDate.localeCompare(b.data.localDate)||a.data.startTime.localeCompare(b.data.startTime)||a.id.localeCompare(b.id);
export function timecardTotals(rows:readonly {data:ShiftData}[]):TimecardTotals{
 return rows.reduce((x,{data})=>({shiftCount:x.shiftCount+1,grossMinutes:x.grossMinutes+data.grossMinutes,
  breakMinutes:x.breakMinutes+(Number.isSafeInteger(data.breakMinutes)&&data.breakMinutes>=0?data.breakMinutes:0),paidMinutes:x.paidMinutes+data.paidMinutes}),
 {shiftCount:0,grossMinutes:0,breakMinutes:0,paidMinutes:0});
}
export function snapshotExportRows(snapshot:AgencyTimecardSnapshot,membershipId?:string){
 const rows=membershipId?snapshot.rows.filter(r=>r.membershipId===membershipId):snapshot.rows;
 if(membershipId&&!rows.length)throw Error('Worker was not in the saved timecard');
 return {rows,paidMinutes:membershipId?timecardTotals(rows).paidMinutes:snapshot.paidMinutes};
}
export function timecardWorkerGroups(rows:readonly Row[],missing:string,reference:string,locale:string){
 const data=new Map<string,Row[]>();
 for(const row of rows){const prior=data.get(row.membershipId);if(prior)prior.push(row);else data.set(row.membershipId,[row]);}
 const groups=[...data].map(([id,values])=>{
  values.sort(timecardRowOrder);
  const label=[...values].reverse().find(r=>r.workerLabel?.name)?.workerLabel??values.find(r=>r.workerLabel?.reference)?.workerLabel;
  return {id,name:workerLabelText(label,missing,reference),rows:values,totals:timecardTotals(values)};
 });
 return groups.sort((a,b)=>a.name.localeCompare(b.name,locale)||a.id.localeCompare(b.id));
}
export function timecardBreakLabel(data:ShiftData,labels:{breakUnreported:string;breakNotTaken:string;breakPaid:string;breakUnpaid:string}){
 return data.breakStatus==='not-reported'?labels.breakUnreported:data.breakStatus==='not-taken'?labels.breakNotTaken:
  data.breakTreatment==='paid'?labels.breakPaid:labels.breakUnpaid;
}
