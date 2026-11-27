import {workerLabelText} from './member-label.ts';
import {isWorkerLocal} from './worker-enrollment.ts';import type {ShiftData,Snapshot} from './timecards';
export type FactoryShift={id:string;worksite_id:string;agency_id:string;membership_id:string;revision:number;source:'self'|'attendance';state:'needs-review'|'needs-confirmation'|'disputed'|'ready';sent:boolean;data:ShiftData};
export type FactorySnapshot=Omit<Snapshot,'source'|'status'>&{source:'connected-factory';status:'received';factoryId:string;factoryName:string;agencyName:string};
export type FactoryHoursContext={factoryAdminRead?:boolean;organizationId:string;membershipId:string;role:'worker'|'team_leader'|'agency_admin'|'factory_admin';sites:{id:string;name:string;factoryId:string;mode:'self'|'attendance'|null;modeRevision:number}[];agencies:{id:string;name:string;worksiteId:string}[];workers:{membershipId:string;agencyId:string}[];assignments:{worksiteId:string;membershipId:string;agencyId:string;agencyName:string}[];placements:{id:string;worksiteId:string;membershipId:string;agencyId:string;startsAt:string;state:string}[];shifts:FactoryShift[];archive:{id:string;worksiteId:string;agencyId:string;dateFrom:string;dateTo:string;snapshot:FactorySnapshot}[]};
export async function factoryHoursCall(org:string,action:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/factory-timecards/'+org+'/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(r.status===401?'login':r.status===403?'denied':['invalid','conflict','period-closed','unresolved','assignment-required'].includes(v.error)?v.error:'uncertain')}
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
export function parseFactorySnapshot(v:unknown):FactorySnapshot{
 const s=v as FactorySnapshot;if(!s||s.source!=='connected-factory'||s.status!=='received'||s.version!==1||s.timeZone!=='Europe/Warsaw'||!uuid(s.organizationId)||!uuid(s.factoryId)||!uuid(s.worksiteId)||!Array.isArray(s.rows)||!s.rows.length||s.rows.some(r=>!uuid(r.id)||!uuid(r.membershipId)||!r.data||!Number.isInteger(r.data.paidMinutes)||r.data.paidMinutes<=0||(r as unknown as {state:string}).state!=='ready')||s.rows.reduce((n,r)=>n+r.data.paidMinutes,0)!==s.paidMinutes)throw Error('unavailable');return s;
}
export function parseFactoryHours(v:unknown,org:string):FactoryHoursContext{
 const c=v as FactoryHoursContext;if(!c||c.organizationId!==org||!uuid(c.membershipId)||!['worker','team_leader','agency_admin','factory_admin'].includes(c.role))throw Error('unavailable');
 for(const k of ['sites','agencies','workers','assignments','placements','shifts','archive'] as const)if(!Array.isArray(c[k]))throw Error('unavailable');
 for(const s of c.sites)if(!uuid(s.id)||!uuid(s.factoryId)||typeof s.name!=='string'||![null,'self','attendance'].includes(s.mode)||!Number.isInteger(s.modeRevision))throw Error('unavailable');
 for(const s of c.shifts)if(!uuid(s.id)||!uuid(s.membership_id)||!uuid(s.worksite_id)||!uuid(s.agency_id)||!['self','attendance'].includes(s.source)||!['needs-review','needs-confirmation','disputed','ready'].includes(s.state)||!Number.isInteger(s.revision)||!s.data||!Number.isInteger(s.data.paidMinutes)||s.data.paidMinutes<=0)throw Error('unavailable');
 for(const a of c.archive){if(!uuid(a.id))throw Error('unavailable');parseFactorySnapshot(a.snapshot);if(c.role==='agency_admin'&&a.snapshot.organizationId!==org)throw Error('unavailable')}
 if(c.role==='worker'&&(c.archive.length||c.shifts.some(s=>s.membership_id!==c.membershipId)||c.assignments.some(s=>s.membershipId!==c.membershipId)))throw Error('unavailable');
 if(c.role==='agency_admin'&&c.shifts.length)throw Error('unavailable');
 if(c.role==='factory_admin'){
  if(c.factoryAdminRead!==true&&(c.shifts.length||c.archive.length))throw Error('unavailable');
  const sites=new Set(c.sites.filter(s=>s.factoryId===org).map(s=>s.id));
  if(c.shifts.some(s=>!sites.has(s.worksite_id))||c.archive.some(a=>!sites.has(a.worksiteId)||
   a.snapshot.factoryId!==org||a.snapshot.worksiteId!==a.worksiteId||a.snapshot.organizationId!==a.agencyId||
   a.snapshot.dateFrom!==a.dateFrom||a.snapshot.dateTo!==a.dateTo))throw Error('unavailable');
 }
 return c;
}
export function factorySnapshotCsv(s:FactorySnapshot,perspective:'sent'|'received'='received'){
 const cell=(v:unknown)=>{let x=String(v??'');if(/^[=+\-@\t\r\n]/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"'};
 const rows:unknown[][]=[['Timeax '+perspective+' factory timecard',s.factoryName,s.worksiteName,s.agencyName,s.dateFrom,s.dateTo,s.timeZone],['Shift ID','Worker / organization reference (archive snapshot)','Revision','Local date','Start','End','Start UTC','End UTC','Gross minutes','Break minutes','Paid minutes','Comment']];
 for(const r of s.rows)rows.push([r.id,workerLabelText(r.workerLabel,'Name not recorded','No.'),r.revision,r.data.localDate,r.data.startTime,r.data.endTime,r.data.startAt,r.data.endAt,r.data.grossMinutes,r.data.breakMinutes,r.data.paidMinutes,r.data.comment]);
 rows.push(['Total paid minutes',s.paidMinutes]);return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')+'\r\n';
}
