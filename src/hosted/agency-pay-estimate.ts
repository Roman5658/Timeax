import type {PayEstimateSetting} from './pay-estimate-settings.ts';
import type {ReportRow} from './timecard-document.ts';

export type EstimateStatus='direct-net'|'gross-with-deductions'|'partial-scope'|'missing-deductions'|'missing-rate'|'deductions-exceed-gross';
export type PayEstimateMonth={month:string;paidMinutes:number;basis?:'gross'|'net';rateCents?:number;hourlyBaseCents?:number;netCents?:number;
 deductions:PayEstimateSetting['deductions'];status:EstimateStatus;deductionsEligible:boolean;override?:true};
export type PayEstimate={workerId:string;months:PayEstimateMonth[];netCents?:number};
export type PayEstimates=ReadonlyMap<string,PayEstimate>;
export type TimecardRateOverride={basis:PayEstimateSetting['basis'];rateCents:number};
export type TimecardRateOverrides=ReadonlyMap<string,TimecardRateOverride>;
export const payRateOverrideKey=(workerId:string,month:string)=>workerId+'|'+month;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;

export function payEstimateScopeIsFullMonth({kind,month,site,days,search}:{
 kind:string;month:string;site:string;days:readonly number[];search:string;
}):string|undefined{
 return kind==='month'&&monthPattern.test(month)&&!site&&!search.trim()&&new Set(days).size===7&&days.every(d=>Number.isInteger(d)&&d>=0&&d<=6)?month:undefined;
}
function hourlyCents(paidMinutes:number,rateCents:number):number|undefined{
 if(!Number.isSafeInteger(paidMinutes)||paidMinutes<0||!Number.isSafeInteger(rateCents)||rateCents<0)return;
 const cents=Number((BigInt(paidMinutes)*BigInt(rateCents)+30n)/60n);
 return Number.isSafeInteger(cents)?cents:undefined;
}
function estimateMonth(month:string,paidMinutes:number,deductionsEligible:boolean,rate?:TimecardRateOverride,deductions:PayEstimateSetting['deductions']=[]):PayEstimateMonth{
 const base={month,paidMinutes,deductionsEligible,deductions:[]};
 if(!rate)return {...base,status:'missing-rate'};
 const hourlyBaseCents=hourlyCents(paidMinutes,rate.rateCents);
 if(hourlyBaseCents===undefined)return {...base,status:'missing-rate'};
 const rated={...base,basis:rate.basis,rateCents:rate.rateCents,hourlyBaseCents};
 if(rate.basis==='net')return {...rated,status:'direct-net',netCents:hourlyBaseCents};
 if(!deductionsEligible)return {...rated,status:'partial-scope'};
 if(!deductions.length)return {...rated,status:'missing-deductions'};
 const deductionTotal=deductions.reduce((sum,d)=>sum+d.cents,0);
 if(!Number.isSafeInteger(deductionTotal)||deductionTotal<0||deductionTotal>hourlyBaseCents)return {...rated,status:'deductions-exceed-gross',deductions};
 return {...rated,status:'gross-with-deductions',deductions,netCents:hourlyBaseCents-deductionTotal};
}
function combineMonths(workerId:string,months:PayEstimateMonth[]):PayEstimate{
 const net=months.every(m=>m.netCents!==undefined)?months.reduce((sum,m)=>sum+m.netCents!,0):undefined;
 return {workerId,months,netCents:net!==undefined&&Number.isSafeInteger(net)?net:undefined};
}
export function applyPayEstimateOverrides(estimates:PayEstimates,overrides:TimecardRateOverrides):PayEstimates{
 if(!overrides.size)return estimates;
 const result=new Map<string,PayEstimate>();
 for(const [workerId,estimate] of estimates){
  const months=estimate.months.map((m):PayEstimateMonth=>{
   const override=overrides.get(payRateOverrideKey(workerId,m.month));
   if(!override||!Number.isSafeInteger(override.rateCents)||override.rateCents<1||override.rateCents>1_000_000||
    override.basis!=='gross'&&override.basis!=='net')return m;
   return {...estimateMonth(m.month,m.paidMinutes,m.deductionsEligible,override,m.basis==='gross'?m.deductions:[]),override:true};
  });
  result.set(workerId,combineMonths(workerId,months));
 }
 return result;
}
export function agencyPayEstimates(report:{rows:readonly Pick<ReportRow,'membershipId'|'data'>[]},settings:readonly PayEstimateSetting[],fullMonth?:string):PayEstimates{
 const byWorker=new Map<string,PayEstimateSetting[]>(),paid=new Map<string,Map<string,number>>();
 for(const setting of settings){
  if(!monthPattern.test(setting.effectiveMonth))continue;
  const prior=byWorker.get(setting.workerId);
  if(prior)prior.push(setting);else byWorker.set(setting.workerId,[setting]);
 }
 for(const items of byWorker.values())items.sort((a,b)=>b.effectiveMonth.localeCompare(a.effectiveMonth)||b.revision-a.revision);
 for(const row of report.rows){
  const month=row.data.localDate.slice(0,7),minutes=row.data.paidMinutes;
  if(!monthPattern.test(month)||!Number.isSafeInteger(minutes)||minutes<=0)continue;
  const sums=paid.get(row.membershipId)??new Map<string,number>();
  sums.set(month,(sums.get(month)??0)+minutes);paid.set(row.membershipId,sums);
 }
 const results=new Map<string,PayEstimate>();
 for(const [workerId,sums] of paid){
  const months=[...sums].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,paidMinutes]):PayEstimateMonth=>{
   const setting=byWorker.get(workerId)?.find(s=>s.effectiveMonth<=month);
   return estimateMonth(month,paidMinutes,month===fullMonth,setting,setting?.deductions);
  });
  results.set(workerId,combineMonths(workerId,months));
 }
 return results;
}

/** Supplemental amounts may describe only the exact displayed internal worker/month rows. */
export function estimatesForRows(rows:readonly ReportRow[],estimates:PayEstimates,membershipId?:string):PayEstimate[]{
 const scoped=new Map<string, Map<string,number>>();
 for(const row of rows){
  if(membershipId&&row.membershipId!==membershipId||row.data.paidMinutes<=0)continue;
  const month=row.data.localDate.slice(0,7),byMonth=scoped.get(row.membershipId)??new Map<string,number>();
  byMonth.set(month,(byMonth.get(month)??0)+row.data.paidMinutes);scoped.set(row.membershipId,byMonth);
 }
 return [...estimates.values()].filter(e=>{
  const months=scoped.get(e.workerId);
  return !!months&&months.size===e.months.length&&e.months.every(m=>months.get(m.month)===m.paidMinutes);
 });
}
