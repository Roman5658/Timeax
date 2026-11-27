import type {Snapshot,ShiftData,TimecardContext,TimecardShift} from './timecards.ts';
import type {AgencyBounds} from './agency-hours-scope.ts';
import type {WorkerLabel} from './member-label.ts';
import type {VisibleAbsence} from './live-timecard-absences.ts';
import type {FactorySnapshot} from './factory-timecards.ts';
import {workerLabelText} from './member-label.ts';

export type AgencyTimecardSnapshot=Snapshot|FactorySnapshot;
export type ReportRow=Snapshot['rows'][number]&{worksiteId?:string;worksiteName?:string;liveState?:TimecardShift['state']};
export type LiveTimekeepingReport={
 source:'internal-live';status:'preview';organizationId:string;worksiteId:string;worksiteName:string;
 dateFrom:string;dateTo:string;timeZone:'Europe/Warsaw';paidMinutes:number;grossMinutes:number;rows:ReportRow[];
 absences?:Array<VisibleAbsence&{name:string}>;
};
export type TimecardReport=AgencyTimecardSnapshot|LiveTimekeepingReport;
type Row=ReportRow;

export function liveTimekeepingReport(scope:TimecardContext,matching:ReadonlyArray<{id:string;rows:TimecardShift[]}>,bounds:AgencyBounds|undefined,allSitesLabel:string,label:(id:string)=>WorkerLabel|undefined,absences?:LiveTimekeepingReport['absences']):LiveTimekeepingReport|undefined{
 if(scope.role!=='agency_admin'||bounds===undefined)return;
 const allowed=new Set(scope.shifts),seen=new Set<string>(),rows:ReportRow[]=[];
 for(const entry of matching)for(const row of entry.rows){
  if(row.membershipId!==entry.id||!allowed.has(row)||seen.has(row.id))continue;
  seen.add(row.id);
  rows.push({id:row.id,membershipId:row.membershipId,revision:row.revision,data:row.data,
   worksiteId:row.worksiteId,worksiteName:row.worksiteName,liveState:row.state,workerLabel:label(row.membershipId)});
 }
 if(!rows.length&&!absences?.length)return;
 rows.sort(timecardRowOrder);
 const unique=new Map([...rows.map(row=>[row.worksiteId!,row.worksiteName!] as const),...(absences??[]).map(row=>[row.worksiteId,row.worksiteName] as const)]);
 const dates=[...rows.map(row=>row.data.localDate),...(absences??[]).flatMap(row=>[row.dateFrom,row.dateTo])].sort();
 const [[worksiteId,worksiteName]]=[...unique];
 const {paidMinutes,grossMinutes}=timecardTotals(rows);
 return {source:'internal-live',status:'preview',organizationId:scope.organizationId,worksiteId:unique.size===1?worksiteId:'',worksiteName:unique.size===1?worksiteName:allSitesLabel,
  dateFrom:bounds?.from??dates[0],dateTo:bounds?.to??dates[dates.length-1],timeZone:scope.timeZone,paidMinutes,grossMinutes,rows,absences};
}
export type TimecardTotals={shiftCount:number;grossMinutes:number;breakMinutes:number;paidMinutes:number};
export const timecardRowOrder=(a:Row,b:Row)=>a.data.localDate.localeCompare(b.data.localDate)||a.data.startTime.localeCompare(b.data.startTime)||a.id.localeCompare(b.id);
export function timecardTotals(rows:readonly {data:ShiftData}[]):TimecardTotals{
 return rows.reduce((x,{data})=>({shiftCount:x.shiftCount+1,grossMinutes:x.grossMinutes+data.grossMinutes,
  breakMinutes:x.breakMinutes+(Number.isSafeInteger(data.breakMinutes)&&data.breakMinutes>=0?data.breakMinutes:0),paidMinutes:x.paidMinutes+data.paidMinutes}),
 {shiftCount:0,grossMinutes:0,breakMinutes:0,paidMinutes:0});
}
export function snapshotExportRows(snapshot:TimecardReport,membershipId?:string){
 const rows=membershipId?snapshot.rows.filter(r=>r.membershipId===membershipId):snapshot.rows;
 if(membershipId&&!rows.length&&!(snapshot.source==='internal-live'&&snapshot.absences?.some(a=>a.membershipId===membershipId)))throw Error('Worker does not match the report scope');
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
