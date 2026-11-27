import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {MonthlyTimecardTable} from './MonthlyTimecardTable';
import {timecardWorkerGroups,type AgencyTimecardSnapshot} from './timecard-document';
import {agencyTimecardsCopy} from './agency-timecards-copy';

export function TimecardReportDrawer({snapshot,sent=false,onClose,csv}:{snapshot:AgencyTimecardSnapshot;sent?:boolean;onClose:()=>void;csv?:{url:string;filename:string}}){
  const {t,i18n}=useTranslation(),tt=(k:string)=>t('timecards.'+k),m=(k:string)=>t('monthlyTimesheets.'+k);
  const saving=useRef(false);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[worker,setWorker]=useState('');
  const locale=i18n.resolvedLanguage||'pl';
  const c=agencyTimecardsCopy(locale);
  const workerOptions=timecardWorkerGroups(snapshot.rows,t('memberNames.historicalMissing'),t('memberNames.reference'),locale);
  const labelCounts=new Map<string,number>();
  for(const {name} of workerOptions)labelCounts.set(name,(labelCounts.get(name)??0)+1);
  async function download(){
    if(saving.current)return;saving.current=true;setBusy(true);setFailed(false);
    try{
      const {downloadAgencyTimecardWorkbook}=await import('./timecard-xlsx');
      await downloadAgencyTimecardWorkbook(snapshot,{
       source:c.source,site:c.site,factory:c.factoryLabel,worker:tt('workerRef'),date:tt('date'),start:tt('start'),end:tt('end'),
       gross:m('gross'),break:m('breaks'),paid:m('paid'),comment:tt('comment'),total:m('productionTotal'),
       worksheet:m('title'),missingName:t('memberNames.historicalMissing'),reference:t('memberNames.reference'),
       internal:c.internal,factorySource:c.factory,timeZone:c.timeZone,locale,scope:c.exportScope,workerExtract:c.workerExtract,
       breakState:t('workflow.breakReport.inputLabel'),breakUnreported:t('workflow.breakReport.notReported'),breakNotTaken:t('breaks.notTaken'),
       breakPaid:t('workflow.breakReport.paidChoice'),breakUnpaid:t('workflow.breakReport.unpaidChoice'),weekday:t('exports.colWeekday'),
       agency:t('workflow.role.agency'),shifts:m('shifts'),status:m('recordStatus.title'),archived:tt('archived'),received:t(sent?'factoryHours.sent':'factoryHours.received'),
       absences:m('absences'),notInSnapshot:c.notInSnapshot,shiftLabel:m('shift')
      },worker||undefined);
    }catch{setFailed(true)}finally{saving.current=false;setBusy(false)}
  }
  return <AgencyBookDrawer title={m('title')} closeLabel={tt('close')} busy={busy} onClose={onClose}>
    <div className="monthly-toolbar hosted-monthly-timecard__export">
     <label className="field-label">{c.exportScope}<select value={worker} disabled={busy} onChange={e=>{setWorker(e.target.value);setFailed(false)}}>
      <option value="">{c.fullDocument}</option>{workerOptions.map(({id,name})=><option key={id} value={id}>{name}{(labelCounts.get(name)??0)>1?' · '+id.slice(0,8):''}</option>)}
     </select></label>
     <button type="button" className="button button--primary" disabled={busy} onClick={()=>void download()}>{busy?c.exporting:c.download}</button>
     {csv&&!worker&&<a className="button button--outline" href={csv.url} download={csv.filename}>{tt('download')}</a>}
    </div>
    {worker&&<p className="muted-copy">{c.extractNotice}</p>}
    {failed&&<p role="alert">{c.exportError}</p>}
    <MonthlyTimecardTable key={worker} snapshot={snapshot} sent={sent} membershipId={worker||undefined}/>
  </AgencyBookDrawer>;
}
