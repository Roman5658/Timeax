import {calendarDate,calendarDayRecords,workerCalendarRecords} from './worker-calendar-data.ts';

export type WorkerRecords=ReturnType<typeof workerCalendarRecords>;
export function workerHistoryMonth(value:unknown):value is string{
 return typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&calendarDate(value+'-01');
}
export function workerHistoryDays(month:string,records:WorkerRecords){
 if(!workerHistoryMonth(month))return [];
 const first=new Date(month+'-01T12:00:00Z');
 first.setUTCMonth(first.getUTCMonth()+1,0);
 return Array.from({length:first.getUTCDate()},(_,i)=>{
  const day=month+'-'+String(i+1).padStart(2,'0');
  return {day,...calendarDayRecords(day,records)};
 }).filter(d=>d.shifts.length||d.absences.length||d.plans.length).reverse();
}
