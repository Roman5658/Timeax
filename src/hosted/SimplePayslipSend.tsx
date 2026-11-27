import {useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {minutesLabel} from './timecards';
import {payslipsCall,parsePayslips,parsePublication,type PayContext} from './payslips';
import {blankSimplePay,buildSimpleIssuePlan,existingSimpleValues,issueSimplePlans,MAX_SIMPLE_PAYSLIPS,simplePayValues,simpleSavedGrossRate,simpleSourceGroups,type SimpleIssueResult,type SimplePayInput} from './payslips-send';
import {PayslipAmounts} from './PayslipAmounts';

export function SimplePayslipSend({context,busy,label,onBusy,onContext,onOpenRates}:{context:PayContext;busy:boolean;label:(id:string)=>string;onBusy:(value:boolean)=>void;onContext:(value:PayContext)=>void;onOpenRates:()=>void}){
 const {t}=useTranslation(),tx=(key:string,args?:Record<string,unknown>)=>t('canonicalPayslips.simple.'+key,args??{});
 const groups=simpleSourceGroups(context);
 const [key,Key]=useState(''),[picked,Picked]=useState<string[]>([]),[inputs,Inputs]=useState<Record<string,SimplePayInput>>({});
 const [result,Result]=useState<SimpleIssueResult[]>([]),[notice,Notice]=useState(''),[sending,Sending]=useState(false);
 const running=useRef(false), group=groups.find(x=>x.key===key)??(!key&&groups.length===1?groups[0]:undefined);
 const available=group?.targets??[];
 const selected=available.filter(x=>picked.includes(x.source.workerKey));
 const plan=new Map(selected.map(x=>[x.source.workerKey,inputs[x.source.workerKey]??existingSimpleValues(x.draft)]));
 const ok=selected.length>0&&selected.length===picked.length&&selected.length<=MAX_SIMPLE_PAYSLIPS&&selected.every(x=>!!simplePayValues(x,plan.get(x.source.workerKey)!));
 const locked=busy||sending||context.settings?.enabled!==true;
 const activeOrg=context.organizationId;
 const setValue=(id:string,input:SimplePayInput)=>Inputs(old=>({...old,[id]:input}));
 function changeGroup(next:string){Key(next);Picked([]);Inputs({});Result([]);Notice('')}
 function toggle(id:string){Picked(old=>old.includes(id)?old.filter(x=>x!==id):old.length<MAX_SIMPLE_PAYSLIPS?[...old,id]:old)}
 async function send(){
  if(running.current||locked||!group||!ok)return;
  running.current=true;Sending(true);onBusy(true);Result([]);Notice('');
  const refresh=async()=>{
   const next=parsePayslips(await payslipsCall(activeOrg,'context'),activeOrg);
   if(next.role!=='agency_admin'||next.membershipId!==context.membershipId)throw Error('denied');
   return next;
  };
  try{
   const fresh=await refresh(), batch=buildSimpleIssuePlan(group,fresh,plan);
   if(!batch){Notice('changed');onContext(fresh);return}
   Result(await issueSimplePlans(batch,(action,body)=>payslipsCall(activeOrg,action,body),value=>parsePublication(value,activeOrg)));
   try{onContext(await refresh())}catch{Notice('refreshFailed')}
  }catch{Notice('refreshFailed')}
  finally{running.current=false;Sending(false);onBusy(false)}
 }
 return <section className="notice-box simple-payslip-send" aria-busy={sending}>
  <h3>{tx('title')}</h3>
  <p>{tx('intro')}</p>
  {!context.settings?.enabled&&<p role="status">{tx('disabled')}</p>}
  {!groups.length?<><p>{tx(context.sources.length?'notEligible':'noSource')}</p>
   <Link className="button button--outline button--full" to={'/workspace/'+activeOrg+'/timecards'}>{t('canonicalPayslips.openTimecards')}</Link></>:
   <form className="auth-form" onSubmit={e=>{e.preventDefault();void send()}}>
    <label className="field-label">{tx('source')}<select value={group?.key??''} disabled={locked} onChange={e=>changeGroup(e.target.value)}>
     <option value="">{t('canonicalPayslips.choose')}</option>{groups.map(g=><option value={g.key} key={g.key}>{g.siteName} · {g.dateFrom} – {g.dateTo} · {t('canonicalPayslips.'+g.kind)}</option>)}
    </select></label>
    {group&&<>
     <fieldset className="payroll-rate-roster" disabled={locked}><legend>{tx('workers')}</legend>
      <button type="button" className="button button--outline" disabled={!available.length||available.length>MAX_SIMPLE_PAYSLIPS}
       onClick={()=>Picked(available.map(s=>s.source.workerKey))}>{tx('selectAll')}</button>
      <button type="button" className="button button--outline" onClick={()=>Picked([])}>{t('canonicalPayslips.clearPeople')}</button>
      {available.length>MAX_SIMPLE_PAYSLIPS&&<p>{t('canonicalPayslips.batchLimit',{count:MAX_SIMPLE_PAYSLIPS})}</p>}
      <div className="payroll-rate-choices">{group.targets.map(({source,rates})=><label key={source.workerKey} className="timecards-check"><input type="checkbox"
       checked={picked.includes(source.workerKey)} disabled={!picked.includes(source.workerKey)&&picked.length>=MAX_SIMPLE_PAYSLIPS}
       onChange={()=>toggle(source.workerKey)}/>{label(source.workerKey)} · {minutesLabel(source.paidMinutes)}{!rates&&<> · {tx('noSavedRateShort')}</>}</label>)}</div>
     </fieldset>
     {group.targets.some(x=>!x.rates)&&<div><p>{tx('rateDistinction')}</p><button type="button" className="button button--outline" disabled={sending} onClick={onOpenRates}>{tx('setOfficialRate')}</button></div>}
     {selected.length>1&&<p>{tx('separateAmounts')}</p>}
     {selected.map(target=>{
      const {source,draft,rates}=target;
      const id=source.workerKey,input=inputs[id]??(draft?existingSimpleValues(draft):blankSimplePay()), preview=simplePayValues(target,input);
      const saved=simpleSavedGrossRate(target), usingOverride=input.grossRateOverride!==undefined;
      const edit=(i:number,patch:Partial<SimplePayInput['deductions'][number]>)=>setValue(id,{...input,deductions:input.deductions.map((x,j)=>j===i?{...x,...patch}:x)});
      return <fieldset key={id} className="simple-payslip-employee" disabled={locked}><legend>{label(id)} · {minutesLabel(source.paidMinutes)}</legend>
       <label className="field-label">{tx('editableGrossRate')}<input inputMode="decimal" maxLength={10}
        placeholder={!saved&&rates?tx('savedShiftRates'):'30,00'} value={input.grossRateOverride??saved??''}
        onChange={e=>setValue(id,{...input,grossRateOverride:e.target.value})}/></label>
       <p className="muted-copy">{tx(usingOverride||!rates?'oneOffRate':'savedRatesDefault')}</p>
       {usingOverride&&rates&&<button type="button" className="button button--outline" onClick={()=>setValue(id,{...input,grossRateOverride:undefined})}>{tx('restoreSavedRates')}</button>}
       <p>{t('canonicalPayslips.manualDeductionHint')}</p>
       {input.deductions.map((d,i)=><div key={i} className="pay-deduction">
        <label className="field-label">{t('canonicalPayslips.deductionName')}<input maxLength={80} placeholder={t('canonicalPayslips.deductionExample')} value={d.name} onChange={e=>edit(i,{name:e.target.value})}/></label>
        <label className="field-label">{t('canonicalPayslips.deductionAmount')}<input inputMode="decimal" maxLength={11} value={d.amount} onChange={e=>edit(i,{amount:e.target.value})}/></label>
        {input.deductions.length>1&&<button type="button" className="button button--outline" onClick={()=>setValue(id,{...input,deductions:input.deductions.filter((_,j)=>j!==i)})}>{t('canonicalPayslips.remove')}</button>}
       </div>)}
       <button type="button" className="button button--outline" disabled={input.deductions.length>=20} onClick={()=>setValue(id,{...input,deductions:[...input.deductions,{name:'',amount:''}]})}>+ {t('canonicalPayslips.addDeduction')}</button>
       {preview?<div role="status"><PayslipAmounts value={{...preview,mode:preview.values.mode,amountCents:preview.values.amountCents,paidMinutes:source.paidMinutes,deductions:preview.values.deductions}}/></div>:<p role="status">{tx(!rates&&!usingOverride?'oneOffRequired':'overrideInvalid')}</p>}
      </fieldset>;
     })}
     {selected.length>0&&<p>{tx('confirmation',{count:selected.length})}</p>}
     <button className="button button--primary button--full" disabled={locked||!ok}>{sending?tx('sending'):tx('send')}</button>
    </>}
   </form>}
  {notice&&<p role="alert">{tx(notice)}</p>}
  {!!result.length&&<div role="status"><p>{tx('result',{sent:result.filter(x=>x.status==='issued').length,count:result.length})}</p>
   {result.some(x=>x.status!=='issued')&&<ul>{result.filter(x=>x.status!=='issued').map(x=><li key={x.memberId}>{label(x.memberId)}: {tx('status.'+x.status)}</li>)}</ul>}
  </div>}
 </section>
}
