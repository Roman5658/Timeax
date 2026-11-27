import {useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {cents,payPreview,type PayContext,type PayDraft,type PayValues} from './payslips';
import {completeRateSnapshot} from './payroll-simple';
import {PayslipAmounts,payslipMoney} from './PayslipAmounts';

export type PayslipAction=(action:string,input:Record<string,unknown>)=>Promise<void>;
const blank={name:'',value:''};
export function PayslipDraftEditor({draft:d,context:c,busy,act,children,label}:{draft:PayDraft;context:PayContext;busy:boolean;act:PayslipAction;children:ReactNode;label:(id:string)=>string}){
 const {t}=useTranslation(),tx=(k:string)=>t('canonicalPayslips.'+k),base=d.calculation;
 const savedAvailable=completeRateSnapshot(d.source.paidMinutes,d.rate_snapshot);
 const [mode,M]=useState<PayValues['mode']>(base?.mode??(savedAvailable?'saved-rates':'gross-rate'));
 const [amount,A]=useState(base?.amountCents==null?'':(base.amountCents/100).toFixed(2));
 const [known,K]=useState(base?.knownNetCents==null?'':(base.knownNetCents/100).toFixed(2));
 const [ded,D]=useState(base?.deductions.length?base.deductions.map(x=>({name:x.name,value:(x.cents/100).toFixed(2)})):[blank]);
 const [note,N]=useState(base?.note??''),[confirmed,C]=useState(false),[assignment,S]=useState(d.assignee_id??'');
 const owner=c.role==='agency_admin',mine=d.assignee_id===c.membershipId||owner&&!d.assignee_id, enabled=c.settings?.enabled!==false;
 const values:PayValues={mode,amountCents:mode==='saved-rates'?null:cents(amount)??null,knownNetCents:known.trim()?cents(known)??-1:null,
  deductions:ded.filter(x=>x.name.trim()||x.value.trim()).map(x=>({name:x.name.trim(),cents:cents(x.value)??-1})),
  note:note.trim()||(mode==='saved-rates'?tx('approvedTimeNote'):'')};
 const completeDeductions=values.deductions.every(x=>x.name.length>=2&&x.name.length<=80&&x.cents>=0);
 const preview=completeDeductions?payPreview(d.source.paidMinutes,d.rate_snapshot,values):undefined;
 const valid=!!preview&&(mode!=='gross-rate'||values.amountCents!==null&&values.amountCents<=1000000)&&
  values.deductions.every(x=>x.name.length>=2&&x.name.length<=80&&x.cents>=0)&&values.note.length>=2&&values.note.length<=500;
 const unchanged=!!base&&JSON.stringify(values)===JSON.stringify({mode:base.mode,amountCents:base.amountCents,knownNetCents:base.knownNetCents,deductions:base.deductions,note:base.note});
 const changed=()=>C(false);
 const amountInput=<label className="field-label">{tx(mode==='gross-rate'?'grossRatePerHour':'amount')}
  <input required inputMode="decimal" value={amount} disabled={busy} onChange={e=>{A(e.target.value);changed()}}/></label>;
 return <article className="notice-box payroll-draft">
  {children}
  {owner&&<details><summary>{tx('assignee')}</summary><form className="auth-form" onSubmit={e=>{e.preventDefault();void act('assign',{id:d.id,revision:d.revision,accountantId:assignment||null})}}>
   <label className="field-label">{tx('assignee')}<select value={assignment} disabled={busy} onChange={e=>S(e.target.value)}>
    <option value="">{tx('agencySelf')}</option>{c.accountants.map(a=><option key={a.id} value={a.id}>{label(a.id)}</option>)}
   </select></label><button className="button button--outline" disabled={busy||assignment===(d.assignee_id??'')}>{tx('assign')}</button>
  </form></details>}
  {!mine?<p>{tx('delegated')}</p>:<form className="auth-form" onSubmit={e=>{e.preventDefault();if(valid&&!unchanged)void act('save',{id:d.id,revision:d.revision,values})}}>
   {mode==='saved-rates'?<p className="muted-copy">{tx('rateSnapshotHint')}</p>:amountInput}
   {mode!=='saved-rates'&&<><p className="muted-copy">{tx('oneOffRateHint')}</p>
    <label className="field-label">{tx('note')}<textarea required minLength={2} maxLength={500} value={note} disabled={busy} onChange={e=>{N(e.target.value);changed()}}/></label></>}
   <h4>{tx('deductions')}</h4><p>{tx('manualDeductionHint')}</p>
   {ded.map((x,i)=><fieldset className="pay-deduction" key={i}><legend>{t('canonicalPayslips.deductionRow',{count:i+1})}</legend>
    <label className="field-label">{tx('deductionName')}<input maxLength={80} value={x.name} placeholder={tx('deductionExample')} disabled={busy} onChange={e=>{D(a=>a.map((d,j)=>j===i?{...d,name:e.target.value}:d));changed()}}/></label>
    <label className="field-label">{tx('deductionAmount')}<input inputMode="decimal" value={x.value} placeholder="100,00" disabled={busy} onChange={e=>{D(a=>a.map((d,j)=>j===i?{...d,value:e.target.value}:d));changed()}}/></label>
    {ded.length>1&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>{D(a=>a.filter((_,j)=>j!==i));changed()}}>{tx('remove')}</button>}
   </fieldset>)}
   <button type="button" className="button button--outline" disabled={busy||ded.length>=20} onClick={()=>{D(a=>[...a,blank]);changed()}}>+ {tx('addDeduction')}</button>
   {preview?<PayslipAmounts value={{...preview,paidMinutes:d.source.paidMinutes,mode,rateSnapshot:d.rate_snapshot,amountCents:values.amountCents,deductions:values.deductions}}/>:<p role="status">{tx('invalidAmounts')}</p>}
   <details><summary>{tx('moreOptions')}</summary>
    <label className="field-label">{tx('method')}<select value={mode} disabled={busy} onChange={e=>{M(e.target.value as PayValues['mode']);changed()}}>
     {(['saved-rates','gross-rate','gross-total','net-total'] as const).map(x=><option key={x} value={x}>{tx(x)}</option>)}
    </select></label>
    <label className="field-label">{tx('knownNet')}<input inputMode="decimal" value={known} disabled={busy} onChange={e=>{K(e.target.value);changed()}}/></label>
    {mode==='saved-rates'&&<label className="field-label">{tx('note')}<textarea maxLength={500} value={note} disabled={busy} onChange={e=>{N(e.target.value);changed()}}/></label>}
   </details>
   <button className="button button--outline button--full" disabled={busy||!valid||unchanged||!enabled}>{tx('save')}</button>
   {base&&<><p>{tx('savedAmounts')}: {payslipMoney(base.grossCents)} / {payslipMoney(base.netCents)}</p>
    <label className="timecards-check"><input type="checkbox" checked={confirmed} disabled={busy||!unchanged||!enabled} onChange={e=>C(e.target.checked)}/>{tx('finalCheck')}</label>
    <button type="button" className="button button--primary button--full" disabled={busy||!unchanged||!confirmed||!enabled} onClick={()=>void act('issue',{id:d.id,revision:d.revision,confirmed:true})}>{tx('issue')}</button>
   </>}
  </form>}
 </article>
}
