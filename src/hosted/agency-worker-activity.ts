import {parseTimecards,type ShiftData} from './timecards.ts';
import {parseFactoryHours} from './factory-timecards.ts';
import type {TeamEntry} from './team-workflow';

export type WorkerActivityScope={organizationId:string;membershipId:string;siteId?:string};
export type ActivityShift={id:string;siteName:string;revision:number;data:ShiftData};
export type ActivityAbsence={id:string;siteName:string;dateFrom:string;dateTo:string;state:'active'|'cancelled'};
const day=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const time=(value:unknown)=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const relevantSite=(site:unknown,wanted?:string)=>!wanted||wanted===site;

function newestShifts(rows:ActivityShift[]){
 const unique=new Map<string,ActivityShift>();
 for(const row of rows){
  const d=row.data;
  if(!day(d.localDate)||!time(d.startTime)||!time(d.endTime)||!Number.isSafeInteger(d.paidMinutes)||d.paidMinutes<=0||!Number.isSafeInteger(row.revision)||row.revision<1)
   throw Error('unavailable');
  const previous=unique.get(row.id);
  if(!previous||previous.revision<row.revision)unique.set(row.id,row);
 }
 return [...unique.values()].sort((a,b)=>b.data.localDate.localeCompare(a.data.localDate)||b.data.startTime.localeCompare(a.data.startTime)||a.id.localeCompare(b.id));
}

export function selectInternalWorkerShifts(response:unknown,{organizationId,membershipId,siteId}:WorkerActivityScope){
 const data=parseTimecards(response,organizationId);
 if(data.role!=='agency_admin')throw Error('denied');
 return newestShifts(data.shifts.filter(row=>row.membershipId===membershipId&&relevantSite(row.worksiteId,siteId))
  .map(({id,worksiteName:siteName,revision,data})=>({id,siteName,revision,data})));
}

export function selectReceivedWorkerShifts(response:unknown,{organizationId,membershipId,siteId}:WorkerActivityScope){
 const data=parseFactoryHours(response,organizationId);
 if(data.role!=='agency_admin')throw Error('denied');
 return newestShifts(data.archive.filter(row=>row.agencyId===organizationId&&row.snapshot.organizationId===organizationId&&
  row.worksiteId===row.snapshot.worksiteId&&relevantSite(row.worksiteId,siteId)).flatMap(({snapshot})=>
  snapshot.rows.filter(r=>r.membershipId===membershipId).map(({id,revision,data})=>({id,revision,data,siteName:snapshot.worksiteName}))));
}

export function selectWorkerAbsences(response:unknown,{organizationId,membershipId,siteId}:WorkerActivityScope):ActivityAbsence[]{
 const c=response as {organizationId?:unknown;role?:unknown;entries?:TeamEntry[];sites?:{id:string;name:string}[]};
 if(c?.organizationId!==organizationId||c.role!=='agency_admin'||!Array.isArray(c.entries)||!Array.isArray(c.sites))throw Error('denied');
 const names=new Map(c.sites.filter(s=>id(s?.id)&&typeof s.name==='string').map(s=>[s.id,s.name]));
 return c.entries.flatMap(row=>{
  // Received reports only. Other workers, ordinary messages, and schedule
  // entries never become an absence in this activity card.
  if(row?.kind!=='absence'||row.sender!==membershipId||row.outgoing!==false||!relevantSite(row.siteId,siteId))return [];
  const {dateFrom,dateTo}=row.payload??{};
  if(!id(row.id)||!day(dateFrom)||!day(dateTo)||dateTo<dateFrom||row.state!=='active'&&row.state!=='cancelled')throw Error('unavailable');
  return [{id:row.id,siteName:row.siteId?names.get(row.siteId)??'':'',dateFrom,dateTo,state:row.state as ActivityAbsence['state']}];
 }).sort((a,b)=>b.dateFrom.localeCompare(a.dateFrom)||b.dateTo.localeCompare(a.dateTo)||a.id.localeCompare(b.id));
}
