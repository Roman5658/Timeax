import type {SetupContext} from './factory-enrollment.ts';
import type {FactoryHoursContext} from './factory-timecards.ts';
import type {PayCalculation,PayContext,PayValues,RateLine} from './payslips.ts';

type Site={id:string;name:string;workerIds:string[]};
type RateChoice={memberId:string;groupId:null;effectiveOn:string;basis:'gross'|'net';cents:number};
const uid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const at=(start:string,end:string|null|undefined,now:number)=>Number.isFinite(Date.parse(start))&&Date.parse(start)<=now&&
  (!end||Number.isFinite(Date.parse(end))&&Date.parse(end)>now);
export const MAX_RATE_BATCH=200;

export function payrollRateRoster(org:string,membershipId:string,workers:PayContext['workers'],setup:SetupContext,connected?:FactoryHoursContext,now=Date.now()):Site[]{
 if(!setup.memberships.some(m=>m.id===membershipId&&m.organizationId===org&&m.kind==='agency'&&m.role==='agency_admin'))return [];
 const own=new Set(workers.map(w=>w.id).filter(uid));
 const internal=setup.worksites.filter(s=>s.ownerKind==='agency'&&s.ownerId===org&&s.organizationId===org).map(s=>({
  id:s.id,name:s.name,workerIds:[...new Set(setup.assignments.filter(a=>a.organizationId===org&&a.worksiteId===s.id&&a.role==='worker'
    &&a.state==='active'&&own.has(a.membershipId)&&at(a.startsAt,a.endsAt,now)).map(a=>a.membershipId))].sort()
 }));
 const external=connected?.organizationId===org&&connected.membershipId===membershipId&&connected.role==='agency_admin'?connected.sites
  .filter(s=>!internal.some(i=>i.id===s.id)&&setup.connections.some(c=>c.agencyId===org&&c.factoryId===s.factoryId&&c.worksiteId===s.id&&c.state==='active'))
  .map(s=>({id:s.id,name:s.name,workerIds:[...new Set(connected.placements.filter(a=>a.agencyId===org&&a.worksiteId===s.id&&a.state==='approved'
    &&own.has(a.membershipId)&&at(a.startsAt,undefined,now)).map(a=>a.membershipId))].sort()})):[];
 return [...internal,...external];
}

export function rateSelection(selection:readonly string[],allowed:readonly string[]){
 if(!selection.length||selection.length>MAX_RATE_BATCH||new Set(selection).size!==selection.length)return undefined;
 const ids=new Set(allowed);
 return selection.every(id=>uid(id)&&ids.has(id))?[...selection].sort():undefined;
}
export function sameRateSelection(a:readonly string[],b:readonly string[]){
 if(a.length!==b.length)return false;
 const sorted=[...b].sort();return [...a].sort().every((id,i)=>id===sorted[i]);
}

export type BatchOutcome={id:string;status:'saved'|'already'|'conflict'|'denied'|'invalid'|'uncertain'|'notAttempted'};
export async function storeRateSelection(
 ids:readonly string[], terms:Omit<RateChoice,'memberId'|'groupId'>, existing:PayContext['rates'],
 write:(value:RateChoice)=>Promise<unknown>
):Promise<BatchOutcome[]>{
 const results:BatchOutcome[]=[];
 let stopped=false;
 for(const id of ids){
  if(stopped){results.push({id,status:'notAttempted'});continue}
  const saved=existing.find(r=>r.member_id===id&&r.group_id===null&&r.effective_on===terms.effectiveOn);
  if(saved){results.push({id,status:saved.basis===terms.basis&&saved.cents===terms.cents?'already':'conflict'});continue}
  try{
   const result=await write({memberId:id,groupId:null,...terms}) as PayContext['rates'][number];
   if(!result||result.member_id!==id||result.group_id!==null||result.effective_on!==terms.effectiveOn||result.basis!==terms.basis||result.cents!==terms.cents)throw Error('uncertain');
   results.push({id,status:'saved'});
  }catch(error){
   const code=error instanceof Error?error.message:'uncertain';
   const status=code==='conflict'?'conflict':code==='denied'||code==='login'?'denied':code==='invalid'?'invalid':'uncertain';
   results.push({id,status});
   stopped=status==='denied'||status==='uncertain';
  }
 }
 return results;
}

export function completeRateSnapshot(minutes:number,rates:RateLine[]){
 return Number.isSafeInteger(minutes)&&minutes>0&&rates.length>0&&rates.every(r=>Number.isSafeInteger(r.minutes)&&r.minutes>0
   &&Number.isSafeInteger(r.cents)&&r.cents!==null&&r.cents>=0&&r.cents<=1000000&&(r.basis==='gross'||r.basis==='net'))&&
   rates.reduce((sum,r)=>sum+r.minutes,0)===minutes&&new Set(rates.map(r=>r.basis)).size===1;
}
export function paidRateSummary(calculation:Pick<PayCalculation,'mode'|'paidMinutes'|'rateSnapshot'|'amountCents'>){
 const {mode,paidMinutes,rateSnapshot,amountCents}=calculation;
 if(mode==='gross-rate'&&Number.isSafeInteger(amountCents)&&amountCents!==null&&amountCents>=0&&amountCents<=1000000)return [{basis:'gross' as const,cents:amountCents,minutes:paidMinutes}];
 if(mode!=='saved-rates'||!completeRateSnapshot(paidMinutes,rateSnapshot))return [];
 const rows=new Map<number,{basis:'gross'|'net';cents:number;minutes:number}>();
 for(const r of rateSnapshot){if(r.cents===null||!r.basis)continue;const old=rows.get(r.cents);
   rows.set(r.cents,{basis:r.basis,cents:r.cents,minutes:r.minutes+(old?.minutes??0)});
 }
 return [...rows.values()];
}

export function payslipCents(value:string):number|undefined{
 const m=/^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(value.trim());
 if(!m)return;
 const n=Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
 return n<=1000000000?n:undefined;
}
export function calculateDisplayedPay(minutes:number,rates:RateLine[],v:PayValues){
 const cash=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1000000000;
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>527040||v.deductions.some(d=>!cash(d.cents)))return;
 const deductions=v.deductions.reduce((n,d)=>n+d.cents,0);
 if(!cash(deductions))return;
 const byRate=(m:number,r:number)=>Math.floor((m*r+30)/60);
 let gross:number,net:number;
 if(v.mode==='saved-rates'){
  if(!completeRateSnapshot(minutes,rates))return;
  const total=rates.reduce((n,r)=>n+byRate(r.minutes,r.cents!),0);
  gross=rates[0].basis==='gross'?total:total+deductions;
  net=gross-deductions;
 }else if(!cash(v.amountCents))return;
 else if(v.mode==='net-total'){net=v.amountCents;gross=net+deductions}
 else if(v.mode==='gross-total'){gross=v.amountCents;net=gross-deductions}
 else if(v.mode==='gross-rate'&&v.amountCents<=1000000){gross=byRate(minutes,v.amountCents);net=gross-deductions}
 else return;
 if(!cash(gross)||!cash(net)||v.knownNetCents!==null&&v.knownNetCents!==net)return;
 return {grossCents:gross,netCents:net,deductionCents:deductions};
}
