import {useEffect,useMemo,useState,useId} from 'react';
import {useTranslation} from 'react-i18next';
import {timecardCall,parseTimecards,type TimecardContext} from './timecards';
import {factoryHoursCall,parseFactoryHours,type FactoryHoursContext} from './factory-timecards';
import {teamCall,type TeamContext} from './team-workflow';
import {workerCalendarCopy} from './worker-calendar-copy';
import {calendarDayRecords,workerCalendarRecords} from './worker-calendar-data';
import '../styles/worker-hosted-calendar.css';

const weekdays=['mon','tue','wed','thu','fri','sat','sun'];
const wardate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthOf=(s:string)=>new Date(s.slice(0,7)+'-01T12:00:00Z');
function dateKey(d:Date){return d.toISOString().slice(0,10)}
export function WorkerCalendar({organizationId,membershipId}:{organizationId:string;membershipId:string}){
 const {t,i18n}=useTranslation(),c=workerCalendarCopy(i18n.language);
 const [selected,setSelected]=useState(wardate),[month,setMonth]=useState(()=>monthOf(wardate()));
 const [internal,setInternal]=useState<TimecardContext>(),[factory,setFactory]=useState<FactoryHoursContext>(),[team,setTeam]=useState<TeamContext>();
 const [revision,refresh]=useState(0),[loading,setLoading]=useState(true),[partial,setPartial]=useState(false);
 const heading=useId(),detail=useId();
 useEffect(()=>{
  const ctl=new AbortController();
  const exact=<T extends {membershipId:string;role:string;organizationId:string},>(v:T)=>{
   if(v.membershipId!==membershipId||v.role!=='worker'||v.organizationId!==organizationId)throw Error('Unavailable');
   return v;
  };
  setLoading(true);setPartial(false);setInternal(undefined);setFactory(undefined);setTeam(undefined);
  Promise.allSettled([
   timecardCall(organizationId,'context',undefined,ctl.signal).then(raw=>exact(parseTimecards(raw,organizationId))),
   factoryHoursCall(organizationId,'context',undefined,ctl.signal).then(raw=>exact(parseFactoryHours(raw,organizationId))),
   teamCall(organizationId,'context',undefined,ctl.signal).then((raw:TeamContext)=>{
    const v=exact(raw);
    if(!Array.isArray(v.entries)||!Array.isArray(v.sites))throw Error('Unavailable');
    return v;
   }),
  ]).then(([a,b,d])=>{
   if(ctl.signal.aborted)return;
   if(a.status==='fulfilled')setInternal(a.value);
   if(b.status==='fulfilled')setFactory(b.value);
   if(d.status==='fulfilled')setTeam(d.value);
   setPartial([a,b,d].some(r=>r.status==='rejected'));setLoading(false);
  });
  return()=>ctl.abort();
 },[organizationId,membershipId,revision]);
 useEffect(()=>{const update=()=>refresh(n=>n+1);window.addEventListener('timeax-team-changed',update);window.addEventListener('timeax-timecards-changed',update);return()=>{window.removeEventListener('timeax-team-changed',update);window.removeEventListener('timeax-timecards-changed',update)}},[]);
 const records=useMemo(()=>workerCalendarRecords({organizationId,membershipId,internal,factory,team}),[organizationId,membershipId,internal,factory,team]);
 const detailRecords=calendarDayRecords(selected,records);
 const dateText=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{dateStyle:'full',timeZone:'UTC'});
 const monthText=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{month:'long',year:'numeric',timeZone:'UTC'}).format(month);
 const count=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate(),today=wardate();
 function advance(delta:number){
  const shown=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+delta,1,12));
  setMonth(shown);setSelected(dateKey(shown));
 }
 return <section className="dashboard-panel worker-calendar-panel worker-hosted-calendar" aria-labelledby={heading} aria-busy={loading}>
  <div className="panel-heading">
   <div><h2 id={heading}>{c.heading}</h2><p aria-live="polite">{monthText}</p></div>
   <div className="calendar-nav">
    <button type="button" className="icon-button" aria-label={t('workflow.calendar.previous')} onClick={()=>advance(-1)}>{'‹'}</button>
    <button type="button" className="icon-button" aria-label={t('workflow.calendar.next')} onClick={()=>advance(1)}>{'›'}</button>
   </div>
  </div>
  <p className="worker-hosted-calendar__legend"><span><i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--shift" aria-hidden="true"/>{c.work}</span><span><i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--absence" aria-hidden="true"/>{c.absence}</span></p>
  <div className="worker-calendar" role="group" aria-label={monthText}>
   {weekdays.map(key=><span className="calendar-weekday" key={key}>{t('workflow.calendar.days.'+key)}</span>)}
   {Array.from({length:(month.getUTCDay()+6)%7},(_,i)=><span key={'blank-'+i} aria-hidden="true"/>)}
   {Array.from({length:count},(_,i)=>{
    const day=dateKey(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),i+1,12))),entry=calendarDayRecords(day,records);
    const name=[dateText.format(new Date(day+'T12:00:00Z')),entry.shifts.length?c.work:'',entry.absences.length?c.absence:''].filter(Boolean).join(', ');
    return <button key={day} type="button" className={'calendar-day worker-hosted-calendar__day'+(selected===day?' is-selected':'')+(today===day?' is-today':'')} aria-pressed={selected===day} aria-current={today===day?'date':undefined} aria-label={name} aria-controls={detail} onClick={()=>setSelected(day)}>
     <span>{i+1}</span><span className="worker-hosted-calendar__daymarks" aria-hidden="true">
      {!!entry.shifts.length&&<i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--shift"/>}
      {!!entry.absences.length&&<i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--absence"/>}
     </span>
    </button>;
   })}
  </div>
  <div id={detail} className="worker-hosted-calendar__detail" aria-live="polite">
   <h3>{dateText.format(new Date(selected+'T12:00:00Z'))}</h3>
   {!loading&&!detailRecords.shifts.length&&!detailRecords.absences.length&&(!partial||internal||factory||team)&&<p>{c.empty}</p>}
   {detailRecords.shifts.map(s=><p key={s.source+s.id}><strong>{s.data.startTime} – {s.data.endTime}</strong>{s.site?' · '+s.site:''} · {t((s.source==='internal'?'timecards.':'factoryHours.')+s.status)}</p>)}
   {detailRecords.absences.map(a=><p key={a.id}>{c.absence}{a.site?' · '+a.site:''}{a.to!==a.from?' · '+a.from+' – '+a.to:''}</p>)}
  </div>
  {loading&&<p role="status">{t('timecards.checking')}</p>}
  {partial&&<p role="status">{c.partial}</p>}
  <button type="button" className="button button--outline" disabled={loading} onClick={()=>refresh(n=>n+1)}>{t('timecards.refresh')}</button>
 </section>;
}

