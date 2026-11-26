import type {WorkerLabel} from './member-label';
import {workerLabelText} from './member-label';
import {isWorkerLocal} from './worker-enrollment';
export type ShiftData={localDate:string;startTime:string;endTime:string;startAt:string;endAt:string;grossMinutes:number;paidMinutes:number;breakMinutes:number;breakStatus:'taken'|'not-taken';breakTreatment:'paid'|'unpaid';comment:string;timeZone:'Europe/Warsaw'};
export type TimecardShift={id:string;worksiteId:string;worksiteName:string;membershipId:string;revision:number;state:'recorded'|'archived';data:ShiftData};
export type TimecardContext={organizationId:string;role:'worker'|'agency_admin';membershipId:string;timeZone:'Europe/Warsaw';worksites:{id:string;name:string}[];shifts:TimecardShift[];archive:{id:string;worksiteId:string;worksiteName:string;dateFrom:string;dateTo:string;paidMinutes:number;createdAt:string}[]};
export type Snapshot={version:1;source:'internal-agency';status:'archived';organizationId:string;worksiteId:string;worksiteName:string;dateFrom:string;dateTo:string;timeZone:'Europe/Warsaw';paidMinutes:number;grossMinutes:number;rows:{id:string;membershipId:string;revision:number;data:ShiftData;workerLabel?:WorkerLabel}[]};
export async function timecardCall(org:string,action:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/timecards/'+org+'/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(r.status===401?'login':r.status===403?'denied':['invalid','conflict','period-closed'].includes(v.error)?v.error:'uncertain')}
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
const id=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const dataValid=(d:ShiftData)=>d&&d.timeZone==='Europe/Warsaw'&&typeof d.localDate==='string'&&typeof d.startTime==='string'&&typeof d.endTime==='string'&&typeof d.comment==='string'&&Number.isInteger(d.paidMinutes)&&d.paidMinutes>0&&Number.isInteger(d.grossMinutes)&&d.grossMinutes>=d.paidMinutes;
export function parseTimecards(v:unknown,org:string):TimecardContext{
 const c=v as TimecardContext;
 if(!c||c.organizationId!==org||!id(c.membershipId)||!['worker','agency_admin'].includes(c.role)||c.timeZone!=='Europe/Warsaw'||!Array.isArray(c.worksites)||!Array.isArray(c.shifts)||!Array.isArray(c.archive))throw Error('unavailable');
 for(const w of c.worksites)if(!id(w.id)||typeof w.name!=='string')throw Error('unavailable');
 for(const s of c.shifts)if(!id(s.id)||!id(s.membershipId)||!id(s.worksiteId)||!Number.isInteger(s.revision)||!['recorded','archived'].includes(s.state)||!dataValid(s.data))throw Error('unavailable');
 for(const a of c.archive)if(!id(a.id)||typeof a.dateFrom!=='string'||typeof a.dateTo!=='string')throw Error('unavailable');
 if(c.role==='worker'&&(c.archive.length||c.shifts.some(s=>s.membershipId!==c.membershipId)))throw Error('unavailable');
 return c;
}
export function parseSnapshot(v:unknown,org:string):Snapshot{
 const s=(v as {snapshot:Snapshot})?.snapshot;
 if(!s||s.version!==1||s.organizationId!==org||s.source!=='internal-agency'||s.status!=='archived'||s.timeZone!=='Europe/Warsaw'||!Number.isInteger(s.paidMinutes)||s.paidMinutes<1||!Number.isInteger(s.grossMinutes)||s.grossMinutes<s.paidMinutes||!Array.isArray(s.rows)||typeof s.worksiteName!=='string'||!s.rows.every(r=>id(r.id)&&id(r.membershipId)&&dataValid(r.data)))throw Error('unavailable');
 return s;
}
export const minutesLabel=(n:number)=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
export function snapshotCsv(s:Snapshot){
 const cell=(value:unknown)=>{let t=String(value??'');if(/^[=+\-@\t\r\n]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"'};
 const rows:unknown[][]=[['Timeax internal agency timecard',s.worksiteName,s.dateFrom,s.dateTo,s.timeZone],['Shift ID','Worker / organization reference (archive snapshot)','Revision','Local start date','Local start','Local end','Start UTC','End UTC','Gross minutes','Break minutes','Break treatment','Paid minutes','Comment']];
 for(const r of s.rows){const d=r.data;rows.push([r.id,workerLabelText(r.workerLabel,'Name not recorded','No.'),r.revision,d.localDate,d.startTime,d.endTime,d.startAt,d.endAt,d.grossMinutes,d.breakMinutes,d.breakTreatment,d.paidMinutes,d.comment])}
 rows.push(['Total paid minutes',s.paidMinutes]);return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')+'\r\n';
}
