import type {PayEstimateSetting} from './pay-estimate-settings.ts';
import type {LiveTimekeepingReport,ReportRow} from './timecard-document.ts';

export type EstimateStatus='direct-net'|'gross-with-deductions'|'partial-scope'|'missing-deductions'|'missing-rate'|'deductions-exceed-gross';
export type PayEstimateMonth={month:string;paidMinutes:number;basis?:'gross'|'net';rateCents?:number;hourlyBaseCents?:number;netCents?:number;
 deductions:PayEstimateSetting['deductions'];status:EstimateStatus};
export type PayEstimate={workerId:string;months:PayEstimateMonth[];netCents?:number};
export type PayEstimates=ReadonlyMap<string,PayEstimate>;
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
export function agencyPayEstimates(report:LiveTimekeepingReport,settings:readonly PayEstimateSetting[],fullMonth?:string):PayEstimates{
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
   const base={month,paidMinutes,deductions:[]};
   if(!setting)return {...base,status:'missing-rate'};
   const hourlyBaseCents=hourlyCents(paidMinutes,setting.rateCents);
   if(hourlyBaseCents===undefined)return {...base,status:'missing-rate'};
   const rated={...base,basis:setting.basis,rateCents:setting.rateCents,hourlyBaseCents};
   if(setting.basis==='net')return {...rated,status:'direct-net',netCents:hourlyBaseCents};
   if(month!==fullMonth)return {...rated,status:'partial-scope'};
   if(!setting.deductions.length)return {...rated,status:'missing-deductions'};
   const deductionTotal=setting.deductions.reduce((sum,d)=>sum+d.cents,0),deductions=setting.deductions;
   if(!Number.isSafeInteger(deductionTotal)||deductionTotal<0||deductionTotal>hourlyBaseCents)return {...rated,status:'deductions-exceed-gross',deductions};
   return {...rated,status:'gross-with-deductions',deductions,netCents:hourlyBaseCents-deductionTotal};
  });
  const net=months.every(m=>m.netCents!==undefined)?months.reduce((sum,m)=>sum+m.netCents!,0):undefined;
  results.set(workerId,{workerId,months,netCents:net!==undefined&&Number.isSafeInteger(net)?net:undefined});
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
