import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {type TimecardShift} from './timecards';

const days=['mon','tue','wed','thu','fri','sat','sun'];
export function WorkerShiftCalendar({value, shifts, disabled, onSelect}: {value:string; shifts:TimecardShift[]; disabled:boolean; onSelect:(day:string)=>void}) {
 const {t,i18n}=useTranslation();
 const [monthOffset,setMonthOffset]=useState(0);
 const base=new Date(value+'T12:00:00Z');
 const [year,month]=Number.isNaN(base.getTime()) ? [new Date().getUTCFullYear(),new Date().getUTCMonth()] : [base.getUTCFullYear(),base.getUTCMonth()];
 const first=new Date(Date.UTC(year,month+monthOffset,1,12));
 const count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 const monthText=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
 const dateText=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{dateStyle:'full',timeZone:'UTC'});
 const prefix=first.toISOString().slice(0,7);
 const totals=new Map<string,number>();
 for(const s of shifts) totals.set(s.data.localDate,(totals.get(s.data.localDate)??0)+1);
 return <section className="dashboard-panel worker-calendar-panel" aria-label={t('workflow.calendar.title')}>
 <div className="panel-heading"><div><span className="eyebrow">{t('workflow.calendar.title')}</span><h2>{monthText}</h2></div>
 <div className="calendar-nav">
 <button type="button" className="icon-button" aria-label={t('workflow.calendar.previous')} onClick={()=>setMonthOffset(n=>n-1)}>{'<'}</button>
 <button type="button" className="icon-button" aria-label={t('workflow.calendar.next')} onClick={()=>setMonthOffset(n=>n+1)}>{'>'}</button>
 </div></div>
 <div className="worker-calendar" role="group" aria-label={t('workflow.calendar.title')}>
 {days.map(key=><span className="calendar-weekday" key={key}>{t('workflow.calendar.days.'+key)}</span>)}
 {Array.from({length:(first.getUTCDay()+6)%7},(_,i)=><span key={'blank-'+i} aria-hidden="true"/>)}
 {Array.from({length:count},(_,i)=>{
 const day=prefix+'-'+String(i+1).padStart(2,'0'), total=totals.get(day)??0;
 const label=dateText.format(new Date(day+'T12:00:00Z'));
 return <button key={day} type="button" className={'calendar-day'+(value===day?' is-selected':'')} aria-pressed={value===day} aria-label={total?label+', '+t('workflow.calendar.shiftCount',{total}):label} disabled={disabled} onClick={()=>{setMonthOffset(0);onSelect(day)}}><span>{i+1}</span>{total>0&&<i aria-hidden="true">{total}</i>}</button>;
 })}
 </div></section>;
}
