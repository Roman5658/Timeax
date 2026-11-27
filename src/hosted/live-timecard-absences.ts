import {agencyPeriodMatches,agencyPeriodOverlaps,type AgencyBounds} from './agency-hours-scope.ts';
import type {TeamContext} from './team-workflow.ts';

export type VisibleAbsence={id:string;membershipId:string;worksiteId:string;worksiteName:string;dateFrom:string;dateTo:string;ranges:Array<{from:string;to:string}>};
export function scopedReportedAbsences(team:TeamContext|undefined,{organizationId,membershipId,site,worker,bounds,days,search,label,language}:{
 organizationId:string;membershipId:string;site:string;worker:string;bounds:AgencyBounds|undefined;
 days:readonly number[];search:string;label:(id:string)=>string;language:string;
}):VisibleAbsence[]|undefined{
 if(!team||team.role!=='agency_admin'||team.organizationId!==organizationId||team.membershipId!==membershipId||
  !Array.isArray(team.entries)||!Array.isArray(team.sites)||!Array.isArray(team.recipients))return;
 if(bounds===undefined||!days.length)return [];
 const sites=new Map(team.sites.map(s=>[s.id,s.name]));
 const people=new Set(team.recipients.filter(r=>r.role==='worker'&&r.organizationId===organizationId).map(r=>r.id));
 const query=search.trim().toLocaleLowerCase(language);
 const results:VisibleAbsence[]=[],seen=new Set<string>();
 for(const e of team.entries){
  if(e.kind!=='absence'||e.state!=='active'||e.outgoing!==false||!people.has(e.sender)||
   worker&&e.sender!==worker||query&&!label(e.sender).toLocaleLowerCase(language).includes(query)||
   !e.siteId||!sites.has(e.siteId)||site&&e.siteId!==site||seen.has(e.id))continue;
  const from=e.payload?.dateFrom,to=e.payload?.dateTo;
  if(typeof from!=='string'||typeof to!=='string'||!agencyPeriodOverlaps(from,to,bounds))continue;
  const first:string=bounds&&from<bounds.from?bounds.from:from;
  const last:string=bounds&&to>bounds.to?bounds.to:to;
  const cursor:Date=new Date(first+'T12:00:00Z'),limits=new Date(to+'T12:00:00Z').getTime()-new Date(from+'T12:00:00Z').getTime();
  if(!Number.isFinite(limits)||limits<0||limits>90*86400000)continue;
  const ranges:VisibleAbsence['ranges']=[];let consecutive=false;
  for(let i=0;i<=90;i++,cursor.setUTCDate(cursor.getUTCDate()+1)){
   const day=cursor.toISOString().slice(0,10);if(day>last)break;
   if(!days.includes(cursor.getUTCDay())||!agencyPeriodMatches(day,bounds)){consecutive=false;continue}
   if(consecutive)ranges[ranges.length-1].to=day;else ranges.push({from:day,to:day});
   consecutive=true;
  }
  if(!ranges.length)continue;
  seen.add(e.id);results.push({id:e.id,membershipId:e.sender,worksiteId:e.siteId,worksiteName:sites.get(e.siteId)!,dateFrom:ranges[0].from,dateTo:ranges.at(-1)!.to,ranges});
 }
 return results.sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom)||a.id.localeCompare(b.id));
}
