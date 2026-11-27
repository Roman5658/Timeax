import {useTranslation} from 'react-i18next';
import {minutesLabel} from './timecards';
import {estimatesForRows,type PayEstimates} from './agency-pay-estimate';
import {timecardWorkerGroups,type LiveTimekeepingReport} from './timecard-document';
import {payEstimateCopy} from './pay-estimate-copy';

export function TimecardPayEstimates({report,estimates,membershipId}:{report:LiveTimekeepingReport;estimates:PayEstimates;membershipId?:string}){
 const {t,i18n}=useTranslation(),locale=i18n.resolvedLanguage||'pl',c=payEstimateCopy(locale);
 const money=new Intl.NumberFormat(locale,{style:'currency',currency:'PLN'});
 const amount=(cents:number|undefined)=>cents===undefined?'—':money.format(cents/100);
 const people=new Map(timecardWorkerGroups(report.rows,t('memberNames.historicalMissing'),t('memberNames.reference'),locale).map(p=>[p.id,p.name]));
 const display=estimatesForRows(report.rows,estimates,membershipId);
 if(!display.length)return null;
 display.sort((a,b)=>(people.get(a.workerId)??'').localeCompare(people.get(b.workerId)??'',locale));
 return <section className="notice-box hosted-monthly-timecard__wages" aria-label={c.title}>
  <div className="panel-heading"><div><h3>{c.title}</h3><p>{c.private}</p></div></div>
  {display.map(person=><details key={person.workerId} open={display.length===1||undefined}>
   <summary><strong>{people.get(person.workerId)}</strong>{person.netCents!==undefined&&<strong>{c.net}: {amount(person.netCents)}</strong>}</summary>
   {person.months.length>1&&person.netCents===undefined&&<p>{c.incomplete}</p>}
   {person.months.map(m=><div className="hosted-monthly-timecard__wage-month" key={m.month}>
    <h4>{m.month}</h4>
    <dl>
     <div><dt>{c.hours}</dt><dd>{minutesLabel(m.paidMinutes)}</dd></div>
     {m.rateCents!==undefined&&<div><dt>{c.rate} ({m.basis==='gross'?'brutto':'netto'})</dt><dd>{amount(m.rateCents)}</dd></div>}
     {m.hourlyBaseCents!==undefined&&<div><dt>{m.basis==='gross'?c.gross:c.netRate}</dt><dd>{amount(m.hourlyBaseCents)}</dd></div>}
     <div><dt>{c.net}</dt><dd>{amount(m.netCents)}</dd></div>
    </dl>
    {!!m.deductions.length&&<p>{c.deductions}: {m.deductions.map(d=>d.name+': '+amount(d.cents)).join('; ')}</p>}
    <p>{c[m.status]}</p>
   </div>)}
  </details>)}
 </section>;
}
