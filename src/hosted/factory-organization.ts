export type FactoryScope={organizationId:string;membershipId:string;worksiteId:string};
export type FactoryRosterUnit={id:string;name:string;kind:'department'|'group';revision:number;departmentId:string|null;leaderId:string|null;workers:string[]};
export type FactoryRoster=FactoryScope&{members:string[];leaders:string[];units:FactoryRosterUnit[]};
export type FactoryScheduleRow={id:string;membershipId:string;localDate:string;startTime:string;endTime:string;state:'active'|'cancelled'};
const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s);
function ids(list:unknown,max:number):list is string[]{
 return Array.isArray(list)&&list.length<=max&&list.every(uuid)&&new Set(list).size===list.length;
}
function same(value:unknown,s:FactoryScope):boolean{
 const x=value as FactoryScope;return !!x&&x.organizationId===s.organizationId&&x.membershipId===s.membershipId&&x.worksiteId===s.worksiteId;
}
export function parseFactoryRoster(value:unknown,scope:FactoryScope):FactoryRoster{
 const v=value as FactoryRoster;
 if(!same(v,scope)||!ids(v.members,20000)||!ids(v.leaders,1000)||!Array.isArray(v.units)||v.units.length>200||!ids(v.units.map(x=>x?.id),200))throw Error('unavailable');
 const members=new Set(v.members),leaders=new Set(v.leaders),departments=new Set(v.units.filter(x=>x.kind==='department').map(x=>x.id));
 for(const x of v.units){
  if(typeof x.name!=='string'||x.name.trim().length<1||x.name.length>80||!['department','group'].includes(x.kind)||!Number.isSafeInteger(x.revision)||x.revision<1||
     !ids(x.workers,200)||x.workers.some(y=>!members.has(y))||x.departmentId!==null&&(x.kind!=='group'||!departments.has(x.departmentId))||
     x.leaderId!==null&&(x.kind!=='group'||!leaders.has(x.leaderId)))throw Error('unavailable');
 }
 return v;
}
export function validFactoryPeriod(dateFrom:string,dateTo:string){
 const day=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 return day(dateFrom)&&day(dateTo)&&dateFrom<=dateTo&&(Date.parse(dateTo)-Date.parse(dateFrom))/86400000<=31;
}
export function parseFactorySchedule(value:unknown,scope:FactoryScope,from:string,to:string){
 const v=value as FactoryScope&{plans:FactoryScheduleRow[]},time=(x:unknown)=>typeof x==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
 if(!same(v,scope)||!validFactoryPeriod(from,to)||!Array.isArray(v.plans)||v.plans.length>1001||
    v.plans.some(x=>!x||!uuid(x.id)||!uuid(x.membershipId)||!validFactoryPeriod(x.localDate,x.localDate)||x.localDate<from||x.localDate>to||!time(x.startTime)||!time(x.endTime)||!['active','cancelled'].includes(x.state))||
    new Set(v.plans.map(x=>x.id+':'+x.membershipId)).size!==v.plans.length)throw Error('unavailable');
 return {rows:v.plans.slice(0,1000),overflow:v.plans.length>1000};
}
