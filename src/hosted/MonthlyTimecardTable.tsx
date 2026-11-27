import {Fragment,useId,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {minutesLabel} from './timecards';
import {timecardBreakLabel,timecardTotals,timecardWorkerGroups,type AgencyTimecardSnapshot} from './timecard-document';
import {agencyTimecardsCopy} from './agency-timecards-copy';
import '../styles/hosted-monthly-timecard.css';

type Props={snapshot:AgencyTimecardSnapshot;membershipId?:string;sent?:boolean};
export function MonthlyTimecardTable({snapshot,membershipId,sent=false}:Props){
 const {t,i18n}=useTranslation(),mt=(key:string)=>t('monthlyTimesheets.'+key),tt=(key:string)=>t('timecards.'+key);
 const disclosureId=useId(),[open,setOpen]=useState<string[]>([]);
 const language=i18n.resolvedLanguage||'pl',copy=agencyTimecardsCopy(language);
 const rows=useMemo(()=>membershipId?snapshot.rows.filter(r=>r.membershipId===membershipId):snapshot.rows,[snapshot,membershipId]);
 const totals=timecardTotals(rows);
 const groups=timecardWorkerGroups(rows,t('memberNames.historicalMissing'),t('memberNames.reference'),language);
 const received=snapshot.status==='received',status=received?t(sent?'factoryHours.sent':'factoryHours.received'):tt('archived');
 const date=new Intl.DateTimeFormat(language,{dateStyle:'medium',timeZone:'UTC'});
 const weekday=new Intl.DateTimeFormat(language,{weekday:'long',timeZone:'UTC'});
 const breaks={breakUnreported:t('workflow.breakReport.notReported'),breakNotTaken:t('breaks.notTaken'),breakPaid:t('workflow.breakReport.paidChoice'),breakUnpaid:t('workflow.breakReport.unpaidChoice')};
 const headers=[mt('workers'),mt('shifts'),mt('gross'),mt('breaks'),mt('paid'),mt('absences')];
 const paid=membershipId?totals.paidMinutes:snapshot.paidMinutes;
 const summary=[groups.length,totals.shiftCount,minutesLabel(totals.grossMinutes),minutesLabel(totals.breakMinutes),minutesLabel(paid),'—'];
 return <section className="monthly-timesheet-panel hosted-monthly-timecard" aria-label={mt('title')}>
  <div className="panel-heading monthly-timesheet-heading">
   <div><span className="eyebrow">{received?snapshot.factoryName+' · ':''}{snapshot.worksiteName}</span>
    <p>{snapshot.dateFrom} – {snapshot.dateTo} · {snapshot.timeZone}</p></div>
   <span className={'monthly-lifecycle monthly-lifecycle--'+(received?'sent':'success')}>{status}</span>
  </div>
  <div className="monthly-summary-grid">
   {headers.map((title,i)=><div key={title}><span>{title}</span><strong>{summary[i]}</strong></div>)}
  </div>
  <p className="monthly-method-note">{copy.notInSnapshot}</p>
  <div className="monthly-worker-table-wrap" tabIndex={0} role="region" aria-label={mt('title')}>
   <table className="monthly-worker-table"><thead><tr>
    <th scope="col">{tt('workerRef')}</th>{headers.slice(1).map(title=><th scope="col" key={title}>{title}</th>)}<th scope="col">{mt('recordStatus.title')}</th>
   </tr></thead><tbody>
    {groups.map(person=>{
      const expanded=membershipId?!open.includes(person.id):open.includes(person.id);
      const rowId=disclosureId+'-'+person.id;
      return <Fragment key={person.id}>
       <tr className="monthly-worker-row"><th scope="row">
        <button type="button" className="monthly-worker-toggle" aria-expanded={expanded} aria-controls={expanded?rowId:undefined}
         onClick={()=>setOpen(ids=>ids.includes(person.id)?ids.filter(id=>id!==person.id):[...ids,person.id])}>{person.name}</button>
       </th>
        <td>{person.totals.shiftCount}</td><td>{minutesLabel(person.totals.grossMinutes)}</td><td>{minutesLabel(person.totals.breakMinutes)}</td>
        <td><strong>{minutesLabel(person.totals.paidMinutes)}</strong></td><td>—</td><td><span className="monthly-record-tag monthly-record-tag--ready">{status}</span></td>
       </tr>
       {expanded&&<tr className="monthly-worker-detail" id={rowId}><td colSpan={7}>
        <div className="monthly-record-list">{person.rows.map(row=>{
         const d=row.data,day=new Date(d.localDate+'T12:00:00.000Z');
         const notice=timecardBreakLabel(d,breaks);
         return <article className="monthly-record monthly-record--shift" key={row.id}>
          <div className="monthly-record-head"><strong>{date.format(day)} · {weekday.format(day)}</strong>
           <span className="monthly-record-tag monthly-record-tag--ready">{status}</span></div>
          <div className="monthly-record-facts">
           <span>{mt('shift')}: {d.startTime} – {d.endTime}</span><span>{mt('gross')}: {minutesLabel(d.grossMinutes)}</span>
           <span>{mt('breaks')}: {notice}{d.breakStatus==='taken'&&d.breakMinutes>0?' · '+minutesLabel(d.breakMinutes):''}</span>
           <strong>{mt('paid')}: {minutesLabel(d.paidMinutes)}</strong>
          </div>{d.comment&&<p className="monthly-record-comment">{d.comment}</p>}
         </article>
        })}</div>
       </td></tr>}
      </Fragment>
    })}
    {!groups.length&&<tr><td colSpan={7}>{mt('noRecords')}</td></tr>}
   </tbody><tfoot><tr>
    <th scope="row">{mt('productionTotal')}</th>{summary.slice(1).map((value,i)=><td key={i}>{value}</td>)}<td>{status}</td>
   </tr></tfoot></table>
  </div>
 </section>;
}
