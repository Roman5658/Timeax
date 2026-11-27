import {useId,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ShiftBreakFields} from '../modules/workflows/components/ShiftBreakFields';
import {RightDrawer} from '../modules/workflows/components/RightDrawer';
import {elapsedShiftMinutes} from '../modules/workflows/domain/zoned-time';
import type {ShiftDraft} from '../modules/workflows/demo-store';
import {timecardCall,minutesLabel} from './timecards';
import {factoryHoursCall} from './factory-timecards';
import type {ShiftTemplate} from './team-workflow';
import {workerShiftCopy} from './worker-shift-copy';

export type WorkerShiftSource='internal'|'factory';
export type QuickTemplate=ShiftTemplate['data'];
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);

function initialDraft(day:string,template?:QuickTemplate):ShiftDraft{
 const paid=template?.breakTreatment==='paid',deduct=template?.breakMinutes??0;
 return {localDate:day,startTime:template?.startTime??'06:00',endTime:template?.endTime??'14:00',comment:'',
  breakStatus:paid||deduct>0?'taken':'not-reported',breakTreatment:paid?'paid':'unpaid',
  breakDurationMinutes:paid?0:deduct,breakStartTime:'',breakEndTime:''};
}

export function WorkerQuickShift({organizationId,source,day,template,onClose,onSaved}:{
 organizationId:string;source:WorkerShiftSource;day:string;template?:QuickTemplate;onClose:()=>void;onSaved:(day:string)=>void;
}){
 const {t,i18n}=useTranslation(),heading=useId(),copy=workerShiftCopy(i18n.language);
 const [draft,setDraft]=useState(()=>initialDraft(day,template));
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const pending=useRef(false),operation=useRef(crypto.randomUUID());
 const update=(apply:(current:ShiftDraft)=>ShiftDraft)=>{setDraft(apply);operation.current=crypto.randomUUID();setNotice('')};
 const gross=elapsedShiftMinutes(draft.localDate,draft.startTime,draft.endTime,'Europe/Warsaw');
 const minutes=draft.breakStatus==='taken'&&draft.breakTreatment==='unpaid'?draft.breakDurationMinutes??0:0;
 const valid=draft.startTime!==draft.endTime&&Number.isInteger(gross)&&gross>0&&gross<=1440&&minutes<gross&&
  (draft.breakStatus!=='taken'||draft.breakTreatment==='paid'||Number.isInteger(minutes)&&minutes>0);
 return <RightDrawer eyebrow={t('workflow.worker.quickEntry')} title={t('workflow.worker.newShift')} titleId={heading} onClose={onClose} busy={busy}>
  {requestClose=><form className="workflow-form worker-quick-entry-form" aria-busy={busy} onSubmit={async e=>{
   e.preventDefault();if(!valid||pending.current)return;pending.current=true;setBusy(true);setNotice('');
   try{
    const call=source==='internal'?timecardCall:factoryHoursCall;
    const result=await call(organizationId,'create',{operationId:operation.current,localDate:draft.localDate,
     startTime:draft.startTime,endTime:draft.endTime,comment:draft.comment.replace(/[\r\n]+/g,' '),
     breakStatus:draft.breakStatus,breakTreatment:draft.breakTreatment,breakMinutes:minutes}) as {id?:unknown;revision?:unknown;saved?:unknown};
    if(result.saved!==true||!uuid(result.id)||typeof result.revision!=='number'||!Number.isSafeInteger(result.revision)||result.revision<1)throw Error('uncertain');
    window.dispatchEvent(new Event('timeax-timecards-changed'));onSaved(draft.localDate);
   }catch(e){const message=(e as Error).message;setNotice(['login','denied','invalid','conflict','period-closed','assignment-required','outside-assignment-period'].includes(message)?message:'uncertain')}
   finally{pending.current=false;setBusy(false)}
  }}>
   <label className="field-label"><span>{t('workflow.fields.date')}</span><input type="date" required disabled={busy} value={draft.localDate} onChange={e=>update(x=>({...x,localDate:e.target.value}))}/></label>
   <label className="field-label"><span>{t('workflow.fields.start')}</span><input type="time" required disabled={busy} value={draft.startTime} onChange={e=>update(x=>({...x,startTime:e.target.value}))}/></label>
   <label className="field-label"><span>{t('workflow.fields.end')}</span><input type="time" required disabled={busy} value={draft.endTime} onChange={e=>update(x=>({...x,endTime:e.target.value}))}/></label>
   <fieldset className="break-entry-fieldset field-label--wide" disabled={busy}><legend>{t('workflow.breakReport.actual')}</legend>
    <div className="workflow-form"><ShiftBreakFields value={draft} onChange={fn=>update(current=>({...current,...fn(current)}))}/></div>
   </fieldset>
   <label className="field-label field-label--wide"><span>{t('workflow.fields.comment')}</span>
    <small className="muted-copy">{t('hostedPrivacy.noteHint')}</small>
    <textarea value={draft.comment} maxLength={500} disabled={busy} rows={2} onChange={e=>update(x=>({...x,comment:e.target.value}))}/>
   </label>
   <div className="duration-preview field-label--wide">
    <span><small>{t('workflow.fields.gross')}</small><strong>{valid?minutesLabel(gross):'—'}</strong></span>
    <span><small>{t('workflow.fields.breakDuration')}</small><strong>{draft.breakStatus==='taken'?minutesLabel(minutes):t('workflow.breakReport.none')}</strong></span>
    <span><small>{t('workflow.fields.paid')}</small><strong>{valid?minutesLabel(gross-minutes):'—'}</strong></span>
   </div>
   {notice&&<p className="notice-box field-label--wide" role="alert">{notice==='assignment-required'?copy.assignmentChanged:notice==='outside-assignment-period'?copy.outsideAssignment:t('timecards.'+notice)}</p>}
   <div className="form-actions field-label--wide">
    <button type="submit" className="button button--primary" disabled={busy||!valid}>{t('workflow.worker.submitShift')}</button>
    <button type="button" className="button button--quiet" disabled={busy} onClick={requestClose}>{t('common.cancel')}</button>
   </div>
  </form>}
 </RightDrawer>;
}
