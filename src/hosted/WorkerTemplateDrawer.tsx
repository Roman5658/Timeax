import {useId,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {RightDrawer} from '../modules/workflows/components/RightDrawer';
import {changed,teamCall,type ShiftTemplate} from './team-workflow';

export function WorkerTemplateDrawer({organizationId,template,onClose}:{
 organizationId:string;template?:ShiftTemplate;onClose:()=>void;
}){
 const {t}=useTranslation(),heading=useId(),tx=(key:string)=>t('team.'+key);
 const [name,setName]=useState(template?.name??'');
 const [startTime,setStart]=useState(template?.data.startTime??'08:00');
 const [endTime,setEnd]=useState(template?.data.endTime??'16:00');
 const [breakMinutes,setMinutes]=useState(template?.data.breakMinutes??0);
 const [paid,setPaid]=useState(template?.data.breakTreatment==='paid');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),operation=useRef(crypto.randomUUID());
 const dirty=()=>{operation.current=crypto.randomUUID();setError('')};
 const valid=!!name.trim()&&!!startTime&&!!endTime&&startTime!==endTime&&Number.isInteger(breakMinutes)&&breakMinutes>=0&&breakMinutes<=720;
 return <RightDrawer eyebrow={t('workflow.templates.eyebrow')} title={tx(template?'editTemplate':'newTemplate')} titleId={heading} onClose={onClose} busy={busy}>
  <form className="auth-form" aria-busy={busy} onSubmit={async event=>{
   event.preventDefault();if(!valid||pending.current)return;
   pending.current=true;setBusy(true);setError('');
   try{
    await teamCall(organizationId,'save-template',{operationId:operation.current,id:template?.id??null,revision:template?.revision??null,
     name:name.trim(),data:{startTime,endTime,breakMinutes,breakTreatment:paid?'paid':'unpaid'}});
    onClose();changed();
   }catch(e){setError((e as Error).message)}
   finally{pending.current=false;setBusy(false)}
  }}>
   <label className="field-label">{tx('name')}<input required maxLength={80} value={name} disabled={busy} onChange={e=>{setName(e.target.value);dirty()}}/></label>
   <div className="timecards-pair">
    <label className="field-label">{t('timecards.start')}<input type="time" required value={startTime} disabled={busy} onChange={e=>{setStart(e.target.value);dirty()}}/></label>
    <label className="field-label">{t('timecards.end')}<input type="time" required value={endTime} disabled={busy} onChange={e=>{setEnd(e.target.value);dirty()}}/></label>
   </div>
   <label className="field-label">{t('timecards.break')}<input type="number" min="0" max="720" required value={Number.isNaN(breakMinutes)?'':breakMinutes} disabled={busy} onChange={e=>{setMinutes(e.target.valueAsNumber);dirty()}}/></label>
   <label className="checkbox-field"><input type="checkbox" checked={paid} disabled={busy} onChange={e=>{setPaid(e.target.checked);dirty()}}/>{t('timecards.paidBreak')}</label>
   {error&&<p role="alert">{tx(error)}</p>}
   <button className="button button--primary" disabled={busy||!valid}>{tx('save')}</button>
  </form>
 </RightDrawer>;
}
