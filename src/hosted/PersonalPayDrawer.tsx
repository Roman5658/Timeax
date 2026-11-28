import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {parsePersonalHourlyRate,type PersonalHourlyRate} from './personal-hourly-rate.ts';

export function PersonalPayDrawer({rate,onSave,onClose}:{rate?:PersonalHourlyRate;onSave:(rate:PersonalHourlyRate)=>boolean;onClose:()=>void}){
 const {t}=useTranslation(),tx=(key:string)=>t('personalPay.'+key);
 const [basis,setBasis]=useState<PersonalHourlyRate['basis']>(rate?.basis??'gross');
 const [amount,setAmount]=useState(rate?(rate.cents/100).toFixed(2):''),[error,setError]=useState('');
 return <AgencyBookDrawer centered title={tx('action')} closeLabel={t('common.close')} onClose={onClose}>
  <form className="auth-form" noValidate onSubmit={e=>{
   e.preventDefault();const rate=parsePersonalHourlyRate(amount,basis);
   if(!rate){setError('invalid');return}
   if(onSave(rate))onClose();else setError('notSaved');
  }}>
   <label className="field-label">{tx('type')}<select value={basis} onChange={e=>{setBasis(e.target.value==='net'?'net':'gross');setError('')}}>
    <option value="gross">{tx('grossHourly')}</option><option value="net">{tx('netHourly')}</option>
   </select></label>
   <label className="field-label">{tx('amount')}<input inputMode="decimal" autoComplete="off" maxLength={10} value={amount} onChange={e=>{setAmount(e.target.value);setError('')}} required aria-invalid={error==='invalid'}/></label>
   <p className="muted-copy">{tx('local')}</p>
   {error&&<p role="alert">{tx(error)}</p>}
   <button className="button button--primary" type="submit">{tx('save')}</button>
  </form>
 </AgencyBookDrawer>;
}
