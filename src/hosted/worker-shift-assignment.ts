import type {TimecardContext} from './timecards.ts';
import type {FactoryHoursContext} from './factory-timecards.ts';

export function resolveWorkerShiftAssignment({organizationId,membershipId,internal,factory,internalKnown,factoryKnown}:{
 organizationId:string;membershipId:string;internal?:TimecardContext;factory?:FactoryHoursContext;
 internalKnown:boolean;factoryKnown:boolean;
}):{state:'ready';source:'internal'|'factory'}|{state:'unknown'|'unassigned'|'multiple'|'disabled'}{
 if(!internalKnown||!factoryKnown)return {state:'unknown'};
 const exact=(c:{organizationId:string;membershipId:string;role:string})=>c.role==='worker'&&c.organizationId===organizationId&&c.membershipId===membershipId;
 if(internal&&!exact(internal)||factory&&!exact(factory))return {state:'unknown'};
 const assigned=new Map<string,{source:'internal'|'factory';enabled:boolean}>();
 for(const s of internal?.worksites??[])assigned.set(s.id,{source:'internal',enabled:s.manualEntry===true});
 for(const a of factory?.assignments??[]){
  if(a.membershipId!==membershipId||a.agencyId!==organizationId)continue;
  const site=factory?.sites.find(s=>s.id===a.worksiteId);
  if(!site||assigned.has(a.worksiteId))return {state:'unknown'};
  assigned.set(site.id,{source:'factory',enabled:site.mode==='self'});
 }
 if(assigned.size===0)return {state:'unassigned'};
 if(assigned.size>1)return {state:'multiple'};
 const [entry]=assigned.values();
 return entry.enabled?{state:'ready',source:entry.source}:{state:'disabled'};
}
