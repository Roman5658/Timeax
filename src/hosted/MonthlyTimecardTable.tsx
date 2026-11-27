import {Fragment,useId,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {minutesLabel} from './timecards';
import {timecardBreakLabel,timecardTotals,timecardWorkerGroups,type TimecardReport,type ReportRow} from './timecard-document';
import {agencyTimecardsCopy} from './agency-timecards-copy';
import type {PayEstimates,TimecardRateOverride} from './agency-pay-estimate';
import {TimecardPayEstimates} from './TimecardPayEstimates';
import '../styles/hosted-monthly-timecard.css';

type Props={snapshot:TimecardReport;membershipId?:string;sent?:boolean;estimates?:PayEstimates;actionBusy?:boolean;onRateChange?:(workerId:string,month:string,rate:TimecardRateOverride|undefined)=>void};
export function MonthlyTimecardTable({snapshot,membershipId,sent=false,estimates,onRateChange,actionBusy}:Props){
 const {t,i18n}=useTranslation(),mt=(key:string)=>t('monthlyTimesheets.'+key),tt=(key:string)=>t('timecards.'+key);
 const disclosureId=useId(),[open,setOpen]=useState<string[]>([]),[view,setView]=useState<'sheet'|'workers'>('sheet');
 const language=i18n.resolvedLanguage||'pl',copy=agencyTimecardsCopy(language);
 const rows=useMemo(()=>membershipId?snapshot.rows.filter(r=>r.membershipId===membershipId):snapshot.rows,[snapshot,membershipId]);
 const totals=timecardTotals(rows);
 const groups=timecardWorkerGroups(rows,t('memberNames.historicalMissing'),t('memberNames.reference'),language);
 const received=snapshot.status==='received',preview=snapshot.status==='preview';
 const absences=preview?snapshot.absences?.filter(a=>!membershipId||a.membershipId===membershipId):undefined;
 const absenceById=new Map<string,NonNullable<typeof absences>>();
 const nameById=new Map(groups.map(g=>[g.id,g.name]));
 for(const a of absences??[]){
  const previous=absenceById.get(a.membershipId);if(previous)previous.push(a);else absenceById.set(a.membershipId,[a]);
  if(!nameById.has(a.membershipId)){nameById.set(a.membershipId,a.name);groups.push({id:a.membershipId,name:a.name,rows:[],totals:timecardTotals([])})}
 }
 const status=received?t(sent?'factoryHours.sent':'factoryHours.received'):preview?copy.preview:tt('archived');
 const date=new Intl.DateTimeFormat(language,{dateStyle:'medium',timeZone:'UTC'});
 const weekday=new Intl.DateTimeFormat(language,{weekday:'long',timeZone:'UTC'});
 const when=(d:string)=>new Date(d+'T12:00:00.000Z');
 const breaks={breakUnreported:t('workflow.breakReport.notReported'),breakNotTaken:t('breaks.notTaken'),breakPaid:t('workflow.breakReport.paidChoice'),breakUnpaid:t('workflow.breakReport.unpaidChoice')};
 const headers=[mt('workers'),mt('shifts'),mt('gross'),mt('breaks'),mt('paid'),preview?copy.reportedAbsences:mt('absences')];
 const paid=membershipId?totals.paidMinutes:snapshot.paidMinutes;
 const summary=[groups.length,totals.shiftCount,minutesLabel(totals.grossMinutes),minutesLabel(totals.breakMinutes),minutesLabel(paid),absences?.length??'—'];
 const rowStatus=(r:ReportRow)=>preview&&r.liveState?tt(r.liveState):status;
 const rowTone=(r:ReportRow)=>preview&&r.liveState!=='archived'?'check':'ready';
 const totalTitle=preview?copy.previewTotal:mt('productionTotal');
 const sheetRows=[...rows.map(row=>({kind:'shift' as const,row,day:row.data.localDate,id:row.id})),
  ...(absences??[]).flatMap(row=>row.ranges.map(range=>({kind:'absence' as const,row:{...row,dateFrom:range.from,dateTo:range.to},day:range.from,id:row.id+':'+range.from})))]
  .sort((a,b)=>a.day.localeCompare(b.day)||a.id.localeCompare(b.id));
 return <section className="monthly-timesheet-panel hosted-monthly-timecard" aria-label={mt('title')}>
  <div className="panel-heading monthly-timesheet-heading">
   <div><span className="eyebrow">{received?snapshot.factoryName+' · ':''}{snapshot.worksiteName}</span>
    <p>{snapshot.dateFrom} – {snapshot.dateTo} · {snapshot.timeZone}</p></div>
   <span className={'monthly-lifecycle monthly-lifecycle--'+(received?'sent':preview?'progress':'success')}>{status}</span>
  </div>
  <div className="monthly-summary-grid">
   {headers.map((title,i)=><div key={title}><span>{title}</span><strong>{summary[i]}</strong></div>)}
  </div>
  {snapshot.source==='internal-live'&&estimates&&<TimecardPayEstimates report={snapshot} estimates={estimates} membershipId={membershipId} onRateChange={onRateChange} actionBusy={actionBusy}/>}
  <p className="monthly-method-note">{preview?(absences===undefined?copy.absenceUnavailable:copy.onlyReports):copy.notInSnapshot}</p>
  <div className="form-actions" role="group" aria-label={mt('title')}>
   <button type="button" aria-pressed={view==='sheet'} className={'button button--small '+(view==='sheet'?'button--primary':'button--outline')} onClick={()=>setView('sheet')}>{copy.sheetView}</button>
   <button type="button" aria-pressed={view==='workers'} className={'button button--small '+(view==='workers'?'button--primary':'button--outline')} onClick={()=>setView('workers')}>{copy.workerView}</button>
  </div>
  {view==='sheet'?<div className="monthly-worker-table-wrap hosted-timesheet-grid" tabIndex={0} role="region" aria-label={copy.sheetView}>
   <table className="monthly-worker-table"><thead><tr>
    {[tt('date'),t('exports.colWeekday'),tt('workerRef'),copy.site,tt('start'),tt('end'),mt('gross'),mt('breaks'),mt('paid'),mt('recordStatus.title'),tt('comment')].map((label,i)=><th key={i} scope="col">{label}</th>)}
   </tr></thead><tbody>
    {sheetRows.map(entry=>{
     const dateAt=when(entry.day);
     if(entry.kind==='absence'){const a=entry.row;return <tr className="hosted-timesheet-grid__absence" key={'absence:'+entry.id}>
      <td>{date.format(dateAt)}{a.dateTo!==a.dateFrom?' – '+date.format(when(a.dateTo)):''}</td><td>{a.dateFrom===a.dateTo?weekday.format(dateAt):'—'}</td>
      <td>{a.name}</td><td>{a.worksiteName}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
      <td><span className="monthly-record-tag monthly-record-tag--absence">{copy.reportedAbsences}</span></td><td></td>
     </tr>}
     const row=entry.row as ReportRow,d=row.data;
     return <tr className="hosted-timesheet-grid__shift" key={'shift:'+row.id}>
      <td>{date.format(dateAt)}</td><td>{weekday.format(dateAt)}</td><td>{nameById.get(row.membershipId)}</td><td>{row.worksiteName??snapshot.worksiteName}</td>
      <td>{d.startTime}</td><td>{d.endTime}</td><td>{minutesLabel(d.grossMinutes)}</td>
      <td>{d.breakStatus==='taken'&&d.breakMinutes>0?minutesLabel(d.breakMinutes)+' · ':''}{timecardBreakLabel(d,breaks)}</td>
      <td><strong>{minutesLabel(d.paidMinutes)}</strong></td>
      <td><span className={'monthly-record-tag monthly-record-tag--'+rowTone(row)}>{rowStatus(row)}</span></td><td>{d.comment}</td>
     </tr>
    })}
    {!sheetRows.length&&<tr><td colSpan={11}>{mt('noRecords')}</td></tr>}
   </tbody><tfoot><tr>
    <th scope="row" colSpan={6}>{totalTitle}</th>
    <td>{minutesLabel(totals.grossMinutes)}</td><td>{minutesLabel(totals.breakMinutes)}</td><td>{minutesLabel(paid)}</td><td colSpan={2}>{status}</td>
   </tr></tfoot></table>
  </div>:<div className="monthly-worker-table-wrap" tabIndex={0} role="region" aria-label={copy.workerView}>
   <table className="monthly-worker-table"><thead><tr>
    <th scope="col">{tt('workerRef')}</th>{headers.slice(1).map(title=><th scope="col" key={title}>{title}</th>)}<th scope="col">{mt('recordStatus.title')}</th>
   </tr></thead><tbody>
    {groups.map(person=>{
      const expanded=membershipId?!open.includes(person.id):open.includes(person.id);
      const rowId=disclosureId+'-'+person.id,ownAbsence=absenceById.get(person.id)??[];
      return <Fragment key={person.id}>
       <tr className="monthly-worker-row"><th scope="row">
        <button type="button" className="monthly-worker-toggle" aria-expanded={expanded} aria-controls={expanded?rowId:undefined}
         onClick={()=>setOpen(ids=>ids.includes(person.id)?ids.filter(id=>id!==person.id):[...ids,person.id])}>{person.name}</button>
       </th>
        <td>{person.totals.shiftCount}</td><td>{minutesLabel(person.totals.grossMinutes)}</td><td>{minutesLabel(person.totals.breakMinutes)}</td>
        <td><strong>{minutesLabel(person.totals.paidMinutes)}</strong></td><td>{absences?ownAbsence.length:'—'}</td>
        <td><span className={'monthly-record-tag monthly-record-tag--'+(preview?'check':'ready')}>{status}</span></td>
       </tr>
       {expanded&&<tr className="monthly-worker-detail" id={rowId}><td colSpan={7}>
        <div className="monthly-record-list">{person.rows.map(row=>{
         const d=row.data,day=when(d.localDate);
         const notice=timecardBreakLabel(d,breaks);
         return <article className="monthly-record monthly-record--shift" key={'shift:'+row.id}>
          <div className="monthly-record-head"><strong>{date.format(day)} · {weekday.format(day)}</strong>
           <span className={'monthly-record-tag monthly-record-tag--'+rowTone(row)}>{rowStatus(row)}</span></div>
          <div className="monthly-record-facts">
           {preview&&row.worksiteName&&<span>{copy.site}: {row.worksiteName}</span>}
           <span>{mt('shift')}: {d.startTime} – {d.endTime}</span><span>{mt('gross')}: {minutesLabel(d.grossMinutes)}</span>
           <span>{mt('breaks')}: {notice}{d.breakStatus==='taken'&&d.breakMinutes>0?' · '+minutesLabel(d.breakMinutes):''}</span>
           <strong>{mt('paid')}: {minutesLabel(d.paidMinutes)}</strong>
          </div>{d.comment&&<p className="monthly-record-comment">{d.comment}</p>}
         </article>
        })}{ownAbsence.map(a=><article className="monthly-record monthly-record--absence" key={'absence:'+a.id}>
          <span className="monthly-record-tag monthly-record-tag--absence">{copy.reportedAbsences}</span><p>{a.ranges.map(r=>r.from===r.to?r.from:r.from+' – '+r.to).join(', ')} · {a.worksiteName}</p>
         </article>)}</div>
       </td></tr>}
      </Fragment>
    })}
    {!groups.length&&<tr><td colSpan={7}>{mt('noRecords')}</td></tr>}
   </tbody><tfoot><tr>
    <th scope="row">{totalTitle}</th>{summary.slice(1).map((value,i)=><td key={i}>{value}</td>)}<td>{status}</td>
   </tr></tfoot></table>
  </div>}
 </section>;
}
