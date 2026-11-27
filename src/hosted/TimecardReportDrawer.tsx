import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {MonthlyTimecardTable} from './MonthlyTimecardTable';
import {timecardWorkerGroups,type TimecardReport} from './timecard-document';
import {agencyTimecardsCopy} from './agency-timecards-copy';
import {timecardWorkbookCopy} from './timecard-workbook-copy';

export function TimecardReportDrawer({snapshot,sent=false,onClose,csv}:{snapshot:TimecardReport;sent?:boolean;onClose:()=>void;csv?:{url:string;filename:string}}){
  const {t,i18n}=useTranslation(),tt=(k:string)=>t('timecards.'+k),m=(k:string)=>t('monthlyTimesheets.'+k);
  const saving=useRef(false);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[worker,setWorker]=useState('');
  const locale=i18n.resolvedLanguage||'pl';
  const c=agencyTimecardsCopy(locale),preview=snapshot.source==='internal-live';
  const workerOptions=timecardWorkerGroups(snapshot.rows,t('memberNames.historicalMissing'),t('memberNames.reference'),locale);
  if(snapshot.source==='internal-live'){
   const existing=new Set(workerOptions.map(w=>w.id));
   for(const a of snapshot.absences??[])if(!existing.has(a.membershipId)){existing.add(a.membershipId);workerOptions.push({id:a.membershipId,name:a.name,rows:[],totals:{shiftCount:0,paidMinutes:0,grossMinutes:0,breakMinutes:0}})}
  }
  const labelCounts=new Map<string,number>();
  for(const {name} of workerOptions)labelCounts.set(name,(labelCounts.get(name)??0)+1);
  async function download(){
    if(saving.current)return;saving.current=true;setBusy(true);setFailed(false);
    try{
      const {downloadAgencyTimecardWorkbook}=await import('./timecard-xlsx');
      await downloadAgencyTimecardWorkbook(snapshot,timecardWorkbookCopy(t,locale,sent),worker||undefined);
    }catch{setFailed(true)}finally{saving.current=false;setBusy(false)}
  }
  return <AgencyBookDrawer title={preview?c.timesheetPreview:m('title')} closeLabel={tt('close')} busy={busy} onClose={onClose}>
    <div className="monthly-toolbar hosted-monthly-timecard__export">
     <label className="field-label">{c.exportScope}<select value={worker} disabled={busy} onChange={e=>{setWorker(e.target.value);setFailed(false)}}>
      <option value="">{preview?c.selectWorker:c.fullDocument}</option>{workerOptions.map(({id,name})=><option key={id} value={id}>{name}{(labelCounts.get(name)??0)>1?' · '+id.slice(0,8):''}</option>)}
     </select></label>
     <button type="button" className="button button--primary" disabled={busy} onClick={()=>void download()}>{busy?c.exporting:c.download}</button>
     {csv&&!worker&&<a className="button button--outline" href={csv.url} download={csv.filename}>{tt('download')}</a>}
    </div>
    {preview&&<p className="muted-copy">{c.liveNotice}</p>}
    {worker&&<p className="muted-copy">{preview?c.liveExtract:c.extractNotice}</p>}
    {failed&&<p role="alert">{c.exportError}</p>}
    <MonthlyTimecardTable key={worker} snapshot={snapshot} sent={sent} membershipId={worker||undefined}/>
  </AgencyBookDrawer>;
}
