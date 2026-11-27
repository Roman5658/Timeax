import type {TimecardShift} from './timecards';
export type AgencyPeriodKind='month'|'year'|'date'|'date-range'|'all';
export type AgencyPeriod={kind:AgencyPeriodKind;month:string;year:string;date:string;from:string;to:string};
export type AgencyBounds={from:string;to:string}|null;
export const weekdays=[1,2,3,4,5,6,0] as const;
export function agencyPeriodToday(now=new Date()):AgencyPeriod{
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 return {kind:'month',month:today.slice(0,7),year:today.slice(0,4),date:today,from:today.slice(0,8)+'01',to:today};
}
function dateValue(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return undefined;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:undefined;
}
export function agencyPeriodBounds(period:AgencyPeriod):AgencyBounds|undefined{
 if(period.kind==='all')return null;
 if(period.kind==='month'){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.month))return;
  const start=period.month+'-01';
  const first=dateValue(start);if(!first)return;
  first.setUTCMonth(first.getUTCMonth()+1,0);
  return {from:start,to:first.toISOString().slice(0,10)};
 }
 if(period.kind==='year')return /^\d{4}$/.test(period.year)&&+period.year>=2000&&+period.year<=2100?
  {from:period.year+'-01-01',to:period.year+'-12-31'}:undefined;
 if(period.kind==='date')return dateValue(period.date)?{from:period.date,to:period.date}:undefined;
 if(dateValue(period.from)&&dateValue(period.to)&&period.from<=period.to)return {from:period.from,to:period.to};
}
export const agencyPeriodMatches=(value:string,bounds:AgencyBounds|undefined)=>
 bounds!==undefined&&!!dateValue(value)&&(!bounds||bounds.from<=value&&value<=bounds.to);
export const agencyPeriodOverlaps=(from:string,to:string,bounds:AgencyBounds|undefined)=>
 bounds!==undefined&&!!dateValue(from)&&!!dateValue(to)&&from<=to&&(!bounds||bounds.from<=to&&from<=bounds.to);
export function agencyShiftGroups(shifts:TimecardShift[],{site,bounds,days,search,worker,label,locale}:{
 site:string;bounds:AgencyBounds|undefined;days:readonly number[];search:string;worker:string;label:(member:string)=>string;locale:string;
}){
 const labelSearch=search.trim().toLocaleLowerCase(locale);
 const matches=new Map<string, {id:string;name:string;rows:TimecardShift[];paidMinutes:number}>();
 for(const row of shifts){
  if(site&&row.worksiteId!==site||worker&&row.membershipId!==worker||!agencyPeriodMatches(row.data.localDate,bounds)||
   !days.includes(dateValue(row.data.localDate)!.getUTCDay()))continue;
  const id=row.membershipId,name=label(id);
  if(labelSearch&&!name.toLocaleLowerCase(locale).includes(labelSearch))continue;
  const group=matches.get(id)??{id,name,rows:[],paidMinutes:0};
  group.rows.push(row);group.paidMinutes+=row.data.paidMinutes;matches.set(id,group);
 }
 for(const item of matches.values())item.rows.sort((a,b)=>b.data.localDate.localeCompare(a.data.localDate)||b.data.startTime.localeCompare(a.data.startTime));
 return [...matches.values()].sort((a,b)=>a.name.localeCompare(b.name,locale)||a.id.localeCompare(b.id));
}
