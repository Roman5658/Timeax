import type {TeamEntry} from './team-workflow';

const time=(value:unknown):value is string=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function day(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function workerScheduleRows(entries:TeamEntry[]){
 return entries.flatMap(e=>{
  const d=e?.payload?.localDate,start=e?.payload?.startTime,end=e?.payload?.endTime;
  return e?.kind==='schedule'&&e.outgoing===false&&(e.state==='active'||e.state==='cancelled')&&day(d)&&time(start)&&time(end)
   ?[{id:e.id,day:d,start,end,cancelled:e.state==='cancelled'}]:[];
 }).sort((a,b)=>b.day.localeCompare(a.day)||a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
