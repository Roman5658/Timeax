import type {PayCalculation,PayContext,PayDraft,PayPublication,PaySource,PayValues,RateLine} from './payslips.ts';
import {calculateDisplayedPay,completeRateSnapshot,payslipCents} from './payroll-simple.ts';

export const MAX_SIMPLE_PAYSLIPS=200;
export const SIMPLE_PAY_NOTE='Rozliczenie według zapisanego czasu i stawek.';
type DeductionInput={name:string;amount:string};
export type SimplePayInput={deductions:DeductionInput[];grossRateOverride?:string};
export const blankSimplePay=():SimplePayInput=>({deductions:[{name:'',amount:''}]});
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const date=(x:unknown):x is string=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x));

export function simplePayValues(target:SimpleTarget,input:SimplePayInput){
 const explicit=input.grossRateOverride!==undefined;
 const cents=explicit?payslipCents(input.grossRateOverride!):undefined;
 if(input.deductions.length>20||(explicit?(cents===undefined||cents<=0||cents>1000000):!target.rates))return;
 const deductions=[];
 for(const item of input.deductions){
  const n=item.name.trim(),a=item.amount.trim();
  if(!n&&!a)continue;
  const cents=payslipCents(a);
  if(n.length<2||n.length>80||/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(n)||cents===undefined||cents<=0)return;
  deductions.push({name:n,cents});
 }
 const values:PayValues={mode:explicit?'gross-rate':'saved-rates',amountCents:cents??null,knownNetCents:null,deductions,note:SIMPLE_PAY_NOTE};
 const rateSnapshot=explicit?[]:target.rates??[];
 const result=calculateDisplayedPay(target.source.paidMinutes,rateSnapshot,values);
 return result&&result.grossCents>0?{values,rateSnapshot,...result}:undefined;
}

const rowFingerprint=(s:PaySource)=>{
 if(!Array.isArray(s.rows)||!s.rows.length)return;
 const seen=new Set<string>();let minutes=0;const rows=[];
 for(const r of s.rows){
  if(!uuid(r.id)||seen.has(r.id)||r.membershipId!==s.workerKey||!Number.isSafeInteger(r.revision)||r.revision<1||
   !r.data||!Number.isSafeInteger(r.data.paidMinutes)||r.data.paidMinutes<=0||!date(r.data.localDate))return;
  seen.add(r.id);minutes+=r.data.paidMinutes;
  rows.push([r.id,r.revision,r.data.localDate,r.data.paidMinutes,r.data.startAt,r.data.endAt]);
 }
 if(minutes!==s.paidMinutes||minutes>527040)return;
 return JSON.stringify(rows.sort(([a],[b])=>String(a).localeCompare(String(b))));
};
const groupKey=(s:PaySource)=>JSON.stringify([s.agencyId,s.kind,s.sourceId,s.siteId,s.dateFrom,s.dateTo]);
const documentScope=(s:PaySource)=>JSON.stringify([groupKey(s),s.workerKey]);
function sameSource(a:PaySource,b:PaySource){
 if(!a||!b||documentScope(a)!==documentScope(b)||a.paidMinutes!==b.paidMinutes)return false;
 const f=rowFingerprint(a);
 return f!==undefined&&f===rowFingerprint(b);
}
function rateFingerprint(rates:RateLine[]|undefined){
 return rates?.map(r=>JSON.stringify([r.shiftId,r.date,r.minutes,r.rateId,r.basis,r.cents,r.effectiveOn,r.scope])).sort().join('|');
}
function sourceRates(source:PaySource,rates:RateLine[]|undefined){
 if(!rates||!completeRateSnapshot(source.paidMinutes,rates)||rates.some(r=>r.basis!=='gross'||!uuid(r.rateId)||!date(r.effectiveOn)||r.effectiveOn>r.date||
  !['individual','group'].includes(r.scope)))return;
 const own=new Map(source.rows.map(row=>[row.id,row]));
 if(rates.length!==own.size||new Set(rates.map(r=>r.shiftId)).size!==own.size||rates.some(r=>{
  const row=own.get(r.shiftId);return !row||r.date!==row.data.localDate||r.minutes!==row.data.paidMinutes;
 }))return;
 return rates;
}
function unambiguousLatest<T extends {effective_on:string}>(values:T[]){
 const sorted=values.sort((a,b)=>b.effective_on.localeCompare(a.effective_on));
 return sorted[0]&&sorted[0].effective_on!==sorted[1]?.effective_on?sorted[0]:undefined;
}
// Mirrors canonical payroll_rate_snapshot only for display/planning. The exact server
// snapshot from create/save is compared before any issue, including all rate IDs.
function currentRatePreview(context:PayContext,source:PaySource){
 const rateFor=(localDate:string)=>{
  const memberId=source.workerKey, eligible=context.rates.filter(r=>date(r.effective_on)&&r.effective_on<=localDate);
  const own=eligible.filter(r=>r.member_id===memberId&&r.group_id===null);
  if(own.length)return unambiguousLatest(own);
  const group=unambiguousLatest(context.groupAssignments.filter(a=>a.member_id===memberId&&date(a.effective_on)&&a.effective_on<=localDate));
  return group&&unambiguousLatest(eligible.filter(r=>r.member_id===null&&r.group_id===group.group_id));
 };
 const rows:RateLine[]=source.rows.map(row=>{
  const rate=rateFor(row.data.localDate);
  return {shiftId:row.id,date:row.data.localDate,minutes:row.data.paidMinutes,rateId:rate?.id??null,
   basis:rate?.basis==='gross'||rate?.basis==='net'?rate.basis:null,cents:rate?.cents??null,effectiveOn:rate?.effective_on??null,
   scope:rate?.member_id?'individual':'group'};
 });
 return sourceRates(source,rows);
}
export type SimpleTarget={source:PaySource;draft?:PayDraft;rates?:RateLine[]};
export function simpleSavedGrossRate(target:SimpleTarget){
 const rates=target.rates;
 if(!rates?.length||rates[0].cents===null||rates.some(r=>r.cents!==rates[0].cents))return undefined;
 return (rates[0].cents/100).toFixed(2);
}
export type SimpleSourceGroup={key:string;kind:PaySource['kind'];siteName:string;dateFrom:string;dateTo:string;targets:SimpleTarget[]};
export function simpleSourceGroups(context:PayContext):SimpleSourceGroup[]{
 if(context.role!=='agency_admin')return [];
 const groups=new Map<string,SimpleSourceGroup>(),duplicates=new Set<string>(),seen=new Set<string>();
 const published=context.published.map(p=>p.document.source);
 for(const source of context.sources){
  if(source.agencyId!==context.organizationId||!uuid(source.sourceId)||!uuid(source.siteId)||!uuid(source.workerKey)||
   !['internal','factory'].includes(source.kind)||!date(source.dateFrom)||!date(source.dateTo)||source.dateFrom>source.dateTo||!rowFingerprint(source))continue;
  const key=groupKey(source),personal=documentScope(source);
  if(seen.has(personal)){duplicates.add(key);continue}
  seen.add(personal);
  if(published.some(issued=>issued.agencyId===source.agencyId&&issued.workerKey===source.workerKey&&issued.siteId===source.siteId&&issued.dateFrom<=source.dateTo&&source.dateFrom<=issued.dateTo))continue;
  const drafts=context.drafts.filter(d=>d.kind===source.kind&&d.source_id===source.sourceId&&d.member_id===source.workerKey);
  if(drafts.length>1)continue;
  const draft=drafts[0];
  if(draft&&(draft.assignee_id!==null||!sameSource(draft.source,source)||
     (draft.calculation!==null&&(!['saved-rates','gross-rate'].includes(draft.calculation.mode)||draft.calculation.note!==SIMPLE_PAY_NOTE))))continue;
  const group=groups.get(key)??{key,kind:source.kind,siteName:source.siteName,dateFrom:source.dateFrom,dateTo:source.dateTo,targets:[]};
  const rates=draft?sourceRates(source,draft.rate_snapshot):currentRatePreview(context,source);
  group.targets.push({source,draft,rates});groups.set(key,group);
 }
 return [...groups.values()].filter(g=>!duplicates.has(g.key)).sort((a,b)=>b.dateTo.localeCompare(a.dateTo));
}
export const existingSimpleValues=(draft:PayDraft|undefined):SimplePayInput=>{
 const c=draft?.calculation;
 return c&&['saved-rates','gross-rate'].includes(c.mode)&&c.note===SIMPLE_PAY_NOTE?
 {...(c.mode==='gross-rate'&&c.amountCents!==null&&{grossRateOverride:(c.amountCents/100).toFixed(2)}),deductions:c.deductions.length?c.deductions.map(d=>({name:d.name,amount:(d.cents/100).toFixed(2)})):[{name:'',amount:''}]}:blankSimplePay();
};

type PlanEntry={target:SimpleTarget;pay:NonNullable<ReturnType<typeof simplePayValues>>};
export function buildSimpleIssuePlan(displayed:SimpleSourceGroup,fresh:PayContext,inputs:ReadonlyMap<string,SimplePayInput>):PlanEntry[]|undefined{
 if(!fresh.settings?.enabled||inputs.size<1||inputs.size>MAX_SIMPLE_PAYSLIPS)return;
 const latest=simpleSourceGroups(fresh).find(g=>g.key===displayed.key);
 if(!latest)return;
 const plan:PlanEntry[]=[];
 for(const [memberId,input] of inputs){
  const target=latest.targets.find(x=>x.source.workerKey===memberId),previous=displayed.targets.find(x=>x.source.workerKey===memberId),pay=target&&simplePayValues(target,input);
  if(!target||!previous||!pay||!sameSource(target.source,previous.source)||pay.values.mode==='saved-rates'&&rateFingerprint(target.rates)!==rateFingerprint(previous.rates)||
   target.draft?.id!==previous.draft?.id||target.draft?.revision!==previous.draft?.revision||
   target.draft?.source_sha256!==previous.draft?.source_sha256)return;
  plan.push({target,pay});
 }
 return plan;
}
function draftMatches(d:PayDraft,target:SimpleTarget,pay:PlanEntry['pay']){
 return d&&uuid(d.id)&&d.agency_id===target.source.agencyId&&d.member_id===target.source.workerKey&&d.source_id===target.source.sourceId&&
  d.kind===target.source.kind&&d.assignee_id===null&&sameSource(d.source,target.source)&&typeof d.source_sha256==='string'&&
  d.source_sha256.length>0&&Array.isArray(d.rate_snapshot)&&
  (pay.values.mode==='gross-rate'||rateFingerprint(sourceRates(target.source,d.rate_snapshot))===rateFingerprint(target.rates))&&Number.isSafeInteger(d.revision)&&d.revision>=1;
}
const valuesMatch=(c:PayCalculation|null|undefined,pay:PlanEntry['pay'],target:SimpleTarget)=>
 !!c&&c.method==='actual-canonical-v1'&&c.currency==='PLN'&&c.mode===pay.values.mode&&c.amountCents===pay.values.amountCents&&
 c.note===pay.values.note&&c.knownNetCents===null&&c.paidMinutes===target.source.paidMinutes&&rateFingerprint(c.rateSnapshot)===rateFingerprint(pay.rateSnapshot)&&c.grossCents===pay.grossCents&&c.netCents===pay.netCents&&
 c.deductionCents===pay.deductionCents&&Array.isArray(c.deductions)&&c.deductions.length===pay.values.deductions.length&&
 c.deductions.every((d,i)=>d.name===pay.values.deductions[i].name&&d.cents===pay.values.deductions[i].cents);
type Outcome='issued'|'conflict'|'invalid'|'denied'|'uncertain'|'notAttempted';
export type SimpleIssueResult={memberId:string;status:Outcome};
type Call=(action:'create'|'save'|'issue',body:Record<string,unknown>)=>Promise<unknown>;
export async function issueSimplePlans(plans:readonly PlanEntry[],call:Call,parseIssued:(x:unknown)=>PayPublication,
 newId=()=>crypto.randomUUID()):Promise<SimpleIssueResult[]>{
 const results:SimpleIssueResult[]=[];let stop=false;
 for(const {target,pay} of plans){
  const source=target.source,memberId=source.workerKey;
  if(stop){results.push({memberId,status:'notAttempted'});continue}
  try{
   let d=target.draft??await call('create',{operationId:newId(),kind:source.kind,sourceId:source.sourceId,memberId}) as PayDraft;
   if(!draftMatches(d,target,pay))throw Error('uncertain');
   if(!target.draft&&d.calculation!==null)throw Error('conflict');
   if(!valuesMatch(d.calculation,pay,target)){
    const saved=await call('save',{operationId:newId(),id:d.id,revision:d.revision,values:pay.values}) as PayDraft;
    if(!draftMatches(saved,target,pay)||saved.id!==d.id||saved.revision!==d.revision+1||saved.source_sha256!==d.source_sha256||!valuesMatch(saved.calculation,pay,target))throw Error('uncertain');
    d=saved;
   }
   const issued=parseIssued(await call('issue',{operationId:newId(),id:d.id,revision:d.revision,confirmed:true}));
   if(issued.id!==d.id||issued.document.sourceSha256!==d.source_sha256||!sameSource(issued.document.source,source)||
      !valuesMatch(issued.document.calculation,pay,target))throw Error('uncertain');
   results.push({memberId,status:'issued'});
  }catch(e){
   const err=e instanceof Error?e.message:'';
   const status=err==='conflict'?'conflict':err==='invalid'?'invalid':err==='login'||err==='denied'?'denied':'uncertain';
   results.push({memberId,status});stop=status==='uncertain'||status==='denied';
  }
 }
 return results;
}
