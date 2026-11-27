import type {TimecardContext,ShiftData} from './timecards.ts';
import type {FactoryHoursContext} from './factory-timecards.ts';
import type {TeamContext} from './team-workflow.ts';

export type CalendarShift={id:string;site:string;data:ShiftData;status:string;source:'internal'|'factory'};
export type CalendarAbsence={id:string;from:string;to:string;site:string};
export type CalendarPlan={id:string;day:string;start:string;end:string;site:string};
export function calendarDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
export function workerCalendarRecords({organizationId,membershipId,internal,factory,team}:{
 organizationId:string;membershipId:string;internal?:TimecardContext;factory?:FactoryHoursContext;team?:TeamContext;
}){
 const same=(v:TimecardContext|FactoryHoursContext|TeamContext|undefined)=>v?.role==='worker'&&v.organizationId===organizationId&&v.membershipId===membershipId;
 const shifts:CalendarShift[]=[];
 const absences:CalendarAbsence[]=[];
 const plans:CalendarPlan[]=[];
 const validShift=(d:ShiftData)=>d&&calendarDate(d.localDate)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.startTime)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(d.endTime);
 if(internal&&same(internal))for(const s of internal.shifts)
  if(s.membershipId===membershipId&&validShift(s.data))shifts.push({id:s.id,site:typeof s.worksiteName==='string'?s.worksiteName:'',data:s.data,status:s.state,source:'internal'});
 if(factory&&same(factory)){
  const names=new Map(factory.sites.map(s=>[s.id,s.name]));
  for(const s of factory.shifts)if(s.membership_id===membershipId&&s.agency_id===organizationId&&validShift(s.data))
   shifts.push({id:s.id,site:names.get(s.worksite_id)??'',data:s.data,status:s.sent?'sent':s.state,source:'factory'});
 }
 if(team&&same(team)){
  const names=new Map(team.sites.map(s=>[s.id,s.name]));
  for(const e of team.entries){
   const from=e.payload?.dateFrom,to=e.payload?.dateTo;
   if(e.kind==='absence'&&e.state==='active'&&e.sender===membershipId&&e.outgoing===true&&calendarDate(from)&&calendarDate(to)&&from<=to)
    absences.push({id:e.id,from,to,site:e.siteId?names.get(e.siteId)??'':''});
   const {localDate,startTime,endTime}=e.payload??{};
   if(e.kind==='schedule'&&e.state==='active'&&e.outgoing===false&&calendarDate(localDate)&&typeof startTime==='string'&&typeof endTime==='string'
    &&/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))
     plans.push({id:e.id,day:localDate,start:startTime,end:endTime,site:e.siteId?names.get(e.siteId)??'':''});
  }
 }
 return {shifts,absences,plans};
}
export function calendarDayRecords(day:string,records:ReturnType<typeof workerCalendarRecords>){
 return {shifts:records.shifts.filter(s=>s.data.localDate===day).sort((a,b)=>a.data.startTime.localeCompare(b.data.startTime)),
  absences:records.absences.filter(a=>a.from<=day&&day<=a.to),plans:records.plans.filter(p=>p.day===day).sort((a,b)=>a.start.localeCompare(b.start))};
}

