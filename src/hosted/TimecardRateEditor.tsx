import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {payEstimateCopy} from './pay-estimate-copy';
import {parseEstimateDraft} from './worker-pay-estimate-form';
import type {PayEstimateMonth,TimecardRateOverride} from './agency-pay-estimate';

export function TimecardRateEditor({workerId,value,disabled,onChange}:{
 workerId:string;value:PayEstimateMonth;disabled:boolean;onChange:(rate:TimecardRateOverride|undefined)=>void;
}){
 const {i18n}=useTranslation(),c=payEstimateCopy(i18n.resolvedLanguage||'pl');
 const [open,setOpen]=useState(false),[invalid,setInvalid]=useState(false);
 const [basis,setBasis]=useState<TimecardRateOverride['basis']>('gross'),[amount,setAmount]=useState('');
 function begin(){
  setBasis(value.basis??'gross');setAmount(value.rateCents===undefined?'':(value.rateCents/100).toFixed(2));setOpen(true);setInvalid(false);
 }
 return <div className="timecard-rate-override">
  {value.override&&<p role="status"><strong>{c.override}</strong></p>}
  {!open?<div className="form-actions">
   <button className="button button--outline button--small" type="button" disabled={disabled} onClick={begin}>{c.editRate}</button>
   {value.override&&<button className="button button--quiet button--small" type="button" disabled={disabled} onClick={()=>onChange(undefined)}>{c.overrideReset}</button>}
  </div>:<form className="auth-form" onSubmit={e=>{
    e.preventDefault();if(disabled)return;
    const parsed=parseEstimateDraft(workerId,value.month,0,{basis,amount,deductions:[]});
    if(!parsed){setInvalid(true);return}
    onChange({basis:parsed.basis,rateCents:parsed.rateCents});setOpen(false);
   }}>
   <p className="muted-copy">{c.overrideHelp}</p>
   <div className="form-actions">
    <label className="field-label">{c.overrideBasis}<select value={basis} disabled={disabled} onChange={e=>{setBasis(e.target.value as TimecardRateOverride['basis']);setInvalid(false)}}>
     <option value="gross">Brutto</option><option value="net">Netto</option>
    </select></label>
    <label className="field-label">{c.overrideAmount}<input value={amount} inputMode="decimal" maxLength={11} required disabled={disabled}
     onChange={e=>{setAmount(e.target.value);setInvalid(false)}} aria-invalid={invalid||undefined}/></label>
   </div>
   {invalid&&<p role="alert">{c.overrideInvalid}</p>}
   <div className="form-actions">
    <button type="submit" className="button button--primary button--small" disabled={disabled}>{c.overrideApply}</button>
    <button type="button" className="button button--quiet button--small" disabled={disabled} onClick={()=>setOpen(false)}>{c.overrideCancel}</button>
   </div>
  </form>}
 </div>;
}
