import type {SetupContext} from './factory-enrollment.ts';
import type {FactoryHoursContext} from './factory-timecards.ts';
import type {TimecardContext} from './timecards.ts';
import type {TeamContext} from './team-workflow.ts';
import type {Request} from './AgencyBackdatedShifts.tsx';
import {calendarDate} from './worker-calendar-data.ts';

type Site={id:string;name:string};
type Shift={id:string;worker:string;site:string;day:string;start:string;end:string;minutes:number;revision:number};
type Activity={shifts:Shift[];absences:{from:string;to:string;site:string}[];plans:Set<string>;messages:number;reviews:Request[]};
export function agencyOverview({org,member,month,initialSites,setup,internal,factory,team,requests,messageStates,now}:{
 org:string;member:string;month:string;initialSites:Site[];setup?:SetupContext;internal?:TimecardContext;
 factory?:FactoryHoursContext;team?:TeamContext;requests:Request[];messageStates?:Readonly<Record<string,string>>;now:number;
}){
 const allowed=setup?.memberships.some(m=>m.organizationId===org&&m.id===member&&m.role==='agency_admin');
 const sites=new Map<string,Site&{kind?:'internal'|'connected';factoryName?:string;workers:Set<string>}>();
 for(const site of initialSites)sites.set(site.id,{...site,workers:new Set()});
 const put=(id:string,name:string,kind:'internal'|'connected',factoryName?:string)=>sites.set(id,{id,name,kind,factoryName,workers:new Set()});
 if(allowed&&setup){
  for(const s of setup.worksites)if(s.organizationId===org&&s.ownerId===org&&s.ownerKind==='agency')put(s.id,s.name,'internal');
  for(const c of setup.connections)if(c.agencyId===org&&c.state==='active')put(c.worksiteId,c.worksiteName,'connected',c.factoryName);
  for(const a of setup.assignments)if(a.organizationId===org&&a.state==='active'&&a.role==='worker'&&Date.parse(a.startsAt)<=now&&(!a.endsAt||Date.parse(a.endsAt)>now))
   sites.get(a.worksiteId)?.workers.add(a.membershipId);
 }
 const shifts=new Map<string,Shift>();
 function add(key:string,s:Shift){
  if(calendarDate(s.day)&&s.day.startsWith(month+'-')&&(!shifts.has(key)||shifts.get(key)!.revision<s.revision))shifts.set(key,s);
 }
 if(internal?.organizationId===org&&internal.membershipId===member&&internal.role==='agency_admin')for(const s of internal.shifts){
  const d=s.data;add('internal:'+s.id,{id:s.id,worker:s.membershipId,site:s.worksiteId,day:d.localDate,start:d.startTime,end:d.endTime,minutes:d.paidMinutes,revision:s.revision});
 }
 if(factory?.organizationId===org&&factory.membershipId===member&&factory.role==='agency_admin'){
  for(const p of factory.placements)if(p.agencyId===org&&p.state==='approved'&&Date.parse(p.startsAt)<=now&&sites.get(p.worksiteId)?.kind==='connected')
   sites.get(p.worksiteId)?.workers.add(p.membershipId);
  for(const a of factory.archive)if(a.agencyId===org&&a.snapshot.organizationId===org&&a.snapshot.worksiteId===a.worksiteId)for(const s of a.snapshot.rows){
   const d=s.data;add('factory:'+s.id,{id:s.id,worker:s.membershipId,site:a.worksiteId,day:d.localDate,start:d.startTime,end:d.endTime,minutes:d.paidMinutes,revision:s.revision});
  }
 }
 const workers=new Map<string,Activity>();
 function activity(id:string){
  if(!workers.has(id))workers.set(id,{shifts:[],absences:[],plans:new Set(),messages:0,reviews:[]});
  return workers.get(id)!;
 }
 for(const s of shifts.values())activity(s.worker).shifts.push(s);
 if(team?.role==='agency_admin'&&team.organizationId===org&&team.membershipId===member){
  for(const e of team.entries)if(!e.outgoing&&e.state==='active'){
   const from=e.payload?.dateFrom,to=e.payload?.dateTo;
   if(e.kind==='absence'&&calendarDate(from)&&calendarDate(to)&&from<=to)
    activity(e.sender).absences.push({from,to,site:e.siteId??''});
   if(e.kind==='message'&&!e.read&&(!messageStates?.['team-message-'+e.id]||messageStates['team-message-'+e.id]==='active'))activity(e.sender).messages++;
  }
  const plans=team.agencySchedule??team.entries.flatMap(e=>e.kind==='schedule'&&e.outgoing?[{
   state:e.state,localDate:e.payload?.localDate,recipients:e.recipients,
  }]:[]);
  for(const plan of plans)if(plan.state==='active'&&calendarDate(plan.localDate)&&plan.localDate.startsWith(month+'-')&&Array.isArray(plan.recipients))
   for(const id of plan.recipients)activity(id).plans.add(plan.localDate);
 }
 for(const r of requests)if(r.state==='pending'&&calendarDate(r.day)&&r.day.startsWith(month+'-'))activity(r.workerId).reviews.push(r);
 return {sites:[...sites.values()],workers,shifts:[...shifts.values()]};
}

export function overviewDays(month:string,activity?:Activity){
 const first=new Date(month+'-01T12:00:00Z'),year=first.getUTCFullYear(),index=first.getUTCMonth();
 return {offset:(first.getUTCDay()+6)%7,days:Array.from({length:new Date(Date.UTC(year,index+1,0,12)).getUTCDate()},(_,i)=>{
  const day=month+'-'+String(i+1).padStart(2,'0'),weekDay=new Date(day+'T12:00:00Z').getUTCDay();
  const shifts=(activity?.shifts.filter(s=>s.day===day)??[]).sort((a,b)=>a.start.localeCompare(b.start));
  const absences=activity?.absences.filter(a=>a.from<=day&&a.to>=day)??[];
  const reviews=activity?.reviews.filter(r=>r.day===day)??[];
  const weekend=weekDay===0||weekDay===6;
  const kind: 'absence'|'review'|'shift'|'planned'|'weekend'|'empty'=absences.length?'absence':reviews.length?'review':shifts.length?'shift':activity?.plans.has(day)?'planned':weekend?'weekend':'empty';
  return {day,shifts,absences,reviews,kind,weekend,minutes:shifts.reduce((n,s)=>n+s.minutes,0)};
 })};
}

export function productionOverview(siteId:string,assigned:ReadonlySet<string>,shifts:Shift[]){
 const tallies=new Map<string,{minutes:number;shifts:number}>();
 for(const s of shifts)if(s.site===siteId){
  const prev=tallies.get(s.worker);
  tallies.set(s.worker,{minutes:(prev?.minutes??0)+s.minutes,shifts:(prev?.shifts??0)+1});
 }
 return {
  totalMinutes:[...tallies.values()].reduce((sum,x)=>sum+x.minutes,0),
  workers:[...new Set([...assigned,...tallies.keys()])].map(id=>({id,assigned:assigned.has(id),minutes:tallies.get(id)?.minutes??0,shifts:tallies.get(id)?.shifts??0})),
 };
}
