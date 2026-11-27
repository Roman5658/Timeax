import type {PayEstimateSetting} from './pay-estimate-settings.ts';

export const MAX_ESTIMATE_ROWS=20;
export const MAX_ESTIMATE_RATE_CENTS=1_000_000;
export const MAX_ESTIMATE_DEDUCTIONS_CENTS=1_000_000_000;
export const MAX_ESTIMATE_NAME_LENGTH=80;
export const validEstimateMonth=(value:string)=>/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
export const warsawEstimateMonth=(now=new Date())=>{
 const parts=new Intl.DateTimeFormat('en',{year:'numeric',month:'2-digit',timeZone:'Europe/Warsaw'}).formatToParts(now);
 return parts.find(p=>p.type==='year')!.value+'-'+parts.find(p=>p.type==='month')!.value;
};
type DeductionDraft={name:string;amount:string};
export type EstimateDraft={basis:PayEstimateSetting['basis'];amount:string;deductions:DeductionDraft[]};
const inputCents=(value:string)=>{
 const parts=/^([0-9]{1,8})(?:[.,]([0-9]{1,2}))?$/.exec(value.trim());
 return parts?Number(parts[1])*100+Number((parts[2]??'').padEnd(2,'0')):undefined;
};
const money=(cents:number)=>Math.floor(cents/100)+'.'+String(cents%100).padStart(2,'0');

export function applicableEstimate(rows:readonly PayEstimateSetting[],workerId:string,month:string){
 const scoped=rows.filter(v=>v.workerId===workerId&&validEstimateMonth(v.effectiveMonth)&&v.effectiveMonth<=month);
 return scoped.reduce<PayEstimateSetting|undefined>((record,v)=>
  !record||record.effectiveMonth<v.effectiveMonth||v.effectiveMonth===record.effectiveMonth&&record.revision<v.revision?v:record,undefined);
}
export function makeEstimateDraft(value:PayEstimateSetting|undefined):EstimateDraft{
 return value?{basis:value.basis,amount:money(value.rateCents),deductions:value.deductions.map(d=>({name:d.name,amount:money(d.cents)}))}
  :{basis:'gross',amount:'',deductions:[]};
}
export function parseEstimateDraft(workerId:string,month:string,revision:number,draft:EstimateDraft):PayEstimateSetting|undefined{
 const rateCents=inputCents(draft.amount);
 if(!validEstimateMonth(month)||!Number.isSafeInteger(revision)||revision<0||revision>999999998||rateCents===undefined||rateCents<1||rateCents>MAX_ESTIMATE_RATE_CENTS||
  draft.basis!=='gross'&&draft.basis!=='net')return;
 const deductions:PayEstimateSetting['deductions']=[];
 if(draft.basis==='gross'){
  if(draft.deductions.length>MAX_ESTIMATE_ROWS)return;
  for(const row of draft.deductions){
   const name=row.name.trim(),cents=inputCents(row.amount);
   if([...name].length<2||[...name].length>MAX_ESTIMATE_NAME_LENGTH||/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(name)||
    cents===undefined||cents<1||cents>MAX_ESTIMATE_DEDUCTIONS_CENTS)return;
   deductions.push({name,cents});
  }
  if(deductions.reduce((sum,d)=>sum+d.cents,0)>MAX_ESTIMATE_DEDUCTIONS_CENTS)return;
 }
 return {workerId,effectiveMonth:month,basis:draft.basis,rateCents,deductions,revision};
}
export function sameEstimateTerms(a:PayEstimateSetting,b:PayEstimateSetting){
 return a.workerId===b.workerId&&a.effectiveMonth===b.effectiveMonth&&a.basis===b.basis&&a.rateCents===b.rateCents&&
  a.deductions.length===b.deductions.length&&a.deductions.every((d,i)=>d.name===b.deductions[i].name&&d.cents===b.deductions[i].cents);
}
