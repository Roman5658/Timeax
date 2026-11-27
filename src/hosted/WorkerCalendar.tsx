import {useEffect,useMemo,useState,useId} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from 'react-router-dom';
import {AlertCircle,CalendarDays,ChevronDown,ChevronUp,Clock3,MessageCircleWarning,Plus,Zap} from 'lucide-react';
import {timecardCall,parseTimecards,minutesLabel,type TimecardContext} from './timecards';
import {factoryHoursCall,parseFactoryHours,type FactoryHoursContext} from './factory-timecards';
import {teamCall,type TeamContext} from './team-workflow';
import {workerCalendarCopy} from './worker-calendar-copy';
import {calendarDayRecords,workerCalendarRecords} from './worker-calendar-data';
import {resolveWorkerShiftAssignment} from './worker-shift-assignment';
import {WorkerQuickShift,type WorkerShiftSource,type QuickTemplate} from './WorkerQuickShift';
import {workerShiftCopy} from './worker-shift-copy';
import {TeamPanel} from './TeamWorkflow';
import {WorkerTemplateDrawer} from './WorkerTemplateDrawer';
import {RightDrawer} from '../modules/workflows/components/RightDrawer';
import '../styles/worker-hosted-calendar.css';

const weekdays=['mon','tue','wed','thu','fri','sat','sun'];
const wardate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthOf=(s:string)=>new Date(s.slice(0,7)+'-01T12:00:00Z');
function dateKey(d:Date){return d.toISOString().slice(0,10)}
export function WorkerCalendar({organizationId,membershipId,enableInternal=true,enableFactory=true,enableTeam=true}:{organizationId:string;membershipId:string;enableInternal?:boolean;enableFactory?:boolean;enableTeam?:boolean}){
 const {t,i18n}=useTranslation(),c=workerCalendarCopy(i18n.language),shiftCopy=workerShiftCopy(i18n.language);
 const lang=(i18n.resolvedLanguage??'en').split('-')[0];
 const planLabel=lang==='ru'?'Смена по графику':lang==='pl'?'Zmiana w grafiku':lang==='uk'?'Запланована зміна':'Scheduled shift';
 const [selected,setSelected]=useState(wardate),[month,setMonth]=useState(()=>monthOf(wardate()));
 const [internal,setInternal]=useState<TimecardContext>(),[factory,setFactory]=useState<FactoryHoursContext>(),[team,setTeam]=useState<TeamContext>();
 const [revision,refresh]=useState(0),[loading,setLoading]=useState(true),[partial,setPartial]=useState(false);
 const heading=useId(),detail=useId(),[templateOpen,setTemplateOpen]=useState(false);
 const absenceHeading=useId(),[absenceDay,setAbsenceDay]=useState<string>();
 const [collapsed,setCollapsed]=useState(false),[saved,setSaved]=useState(false),[reviewPending,setReviewPending]=useState<string>(),[entry,setEntry]=useState<{source:WorkerShiftSource;day:string;template?:QuickTemplate}>();
 useEffect(()=>{
  const ctl=new AbortController();
  const exact=<T extends {membershipId:string;role:string;organizationId:string},>(v:T)=>{
   if(v.membershipId!==membershipId||v.role!=='worker'||v.organizationId!==organizationId)throw Error('Unavailable');
   return v;
  };
  setLoading(true);setPartial(false);setInternal(undefined);setFactory(undefined);setTeam(undefined);
  Promise.allSettled([
   enableInternal?timecardCall(organizationId,'context',undefined,ctl.signal).then(raw=>exact(parseTimecards(raw,organizationId))):Promise.resolve(undefined),
   enableFactory?factoryHoursCall(organizationId,'context',undefined,ctl.signal).then(raw=>exact(parseFactoryHours(raw,organizationId))):Promise.resolve(undefined),
   enableTeam?teamCall(organizationId,'context',undefined,ctl.signal).then((raw:TeamContext)=>{
    const v=exact(raw);
    if(!Array.isArray(v.entries)||!Array.isArray(v.sites)||!Array.isArray(v.templates))throw Error('Unavailable');
    return v;
   }):Promise.resolve(undefined),
  ]).then(([a,b,d])=>{
   if(ctl.signal.aborted)return;
   if(a.status==='fulfilled')setInternal(a.value);
   if(b.status==='fulfilled')setFactory(b.value);
   if(d.status==='fulfilled')setTeam(d.value);
   setPartial([a,b,d].some(r=>r.status==='rejected'));setLoading(false);
  });
  return()=>ctl.abort();
 },[organizationId,membershipId,revision,enableInternal,enableFactory,enableTeam]);
 useEffect(()=>{const update=()=>refresh(n=>n+1);window.addEventListener('timeax-team-changed',update);window.addEventListener('timeax-timecards-changed',update);return()=>{window.removeEventListener('timeax-team-changed',update);window.removeEventListener('timeax-timecards-changed',update)}},[]);
 const records=useMemo(()=>workerCalendarRecords({organizationId,membershipId,internal,factory,team}),[organizationId,membershipId,internal,factory,team]);
 const detailRecords=calendarDayRecords(selected,records);
 const assignment=resolveWorkerShiftAssignment({organizationId,membershipId,internal,factory,internalKnown:!enableInternal||!!internal,factoryKnown:!enableFactory||!!factory});
 function openShift(template?:QuickTemplate){if(!loading&&assignment.state==='ready'){setSaved(false);setReviewPending(undefined);setEntry({source:assignment.source,day:selected,template})}}
 const dateText=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{dateStyle:'full',timeZone:'UTC'});
 const monthText=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{month:'long',year:'numeric',timeZone:'UTC'}).format(month);
 const count=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate(),today=wardate();
 function advance(delta:number){
  const shown=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+delta,1,12));
  setMonth(shown);setSelected(dateKey(shown));
 }
 const monthly=records.shifts.filter(s=>s.data.localDate.startsWith(dateKey(month).slice(0,7)));
 const paid=monthly.filter(s=>s.source==='internal'||['ready','sent'].includes(s.status)).reduce((sum,s)=>sum+s.data.paidMinutes,0);
 const cards=[
  {title:t('dashboard.statHours'),value:minutesLabel(paid),icon:Clock3,color:'mint'},
  {title:t('dashboard.statShifts'),value:monthly.length,icon:CalendarDays,color:'blue'},
  {title:t('workflow.worker.pendingStatus'),value:monthly.filter(s=>['needs-review','needs-confirmation'].includes(s.status)).length,icon:MessageCircleWarning,color:'peach'},
  {title:t('workflow.dispute.eyebrow'),value:monthly.filter(s=>s.status==='disputed').length,icon:AlertCircle,color:'peach'},
 ];
 const templates=team?.templates.filter(v=>v&&typeof v.name==='string'&&typeof v.id==='string'&&v.data&&/^\d\d:\d\d$/.test(v.data.startTime)&&/^\d\d:\d\d$/.test(v.data.endTime)&&['paid','unpaid'].includes(v.data.breakTreatment)&&Number.isInteger(v.data.breakMinutes)&&v.data.breakMinutes>=0)??[];
 const root='/workspace/'+organizationId;
 return <>
 <div className="workflow-stat-grid workflow-stat-grid--four" aria-busy={loading}>
  {cards.map(({title,value,icon:Icon,color})=><div className="workflow-stat-card" key={title}><span className={'stat-icon stat-icon--'+color}><Icon size={18} aria-hidden="true"/></span><span>{title}</span><strong>{loading||partial?'—':value}</strong></div>)}
 </div>
 {enableTeam&&<div className="form-actions worker-home-absence"><button className="button button--outline button--small" type="button" onClick={()=>setAbsenceDay(selected)}><MessageCircleWarning size={16} aria-hidden="true"/>{t('workflow.absence.reportButton')}</button></div>}
 <section className="dashboard-panel worker-calendar-panel worker-hosted-calendar" aria-labelledby={heading} aria-busy={loading}>
  <div className="panel-heading">
   <div><span className="eyebrow">{c.heading}</span><h2 id={heading} aria-live="polite">{monthText}</h2></div>
   <div className="calendar-nav">
    <button type="button" className="text-button calendar-collapse-toggle" aria-expanded={!collapsed} onClick={()=>setCollapsed(x=>!x)} aria-label={t(collapsed?'workflow.calendar.expand':'workflow.calendar.collapse')}><span className="calendar-collapse-label">{t(collapsed?'workflow.calendar.expand':'workflow.calendar.collapse')}</span><span className="calendar-collapse-icon" aria-hidden="true">{collapsed?<ChevronDown size={16}/>:<ChevronUp size={16}/>}</span></button>
    <button type="button" className="icon-button" aria-label={t('workflow.calendar.previous')} onClick={()=>advance(-1)}>{'‹'}</button>
    <button type="button" className="icon-button" aria-label={t('workflow.calendar.next')} onClick={()=>advance(1)}>{'›'}</button>
   </div>
  </div>
  {!collapsed&&<><div className="worker-calendar" role="group" aria-label={monthText}>
   {weekdays.map(key=><span className="calendar-weekday" key={key}>{t('workflow.calendar.days.'+key)}</span>)}
   {Array.from({length:(month.getUTCDay()+6)%7},(_,i)=><span key={'blank-'+i} aria-hidden="true"/>)}
   {Array.from({length:count},(_,i)=>{
    const day=dateKey(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),i+1,12))),entry=calendarDayRecords(day,records);
    const name=[dateText.format(new Date(day+'T12:00:00Z')),entry.shifts.length?c.work:'',entry.absences.length?c.absence:'',entry.plans.length?planLabel:''].filter(Boolean).join(', ');
    return <button key={day} type="button" className={'calendar-day worker-hosted-calendar__day'+(selected===day?' is-selected':'')+(today===day?' is-today':'')+(entry.shifts.length?' has-work-record':'')+(entry.absences.length?' has-reported-absence':'')} aria-pressed={selected===day} aria-current={today===day?'date':undefined} aria-label={name} aria-controls={detail} onClick={()=>setSelected(day)}>
     <span>{i+1}</span><span className="worker-hosted-calendar__daymarks" aria-hidden="true">
      {!!entry.shifts.length&&<i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--shift"/>}
      {!!entry.absences.length&&<i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--absence"/>}
      {!!entry.plans.length&&<i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--planned"/>}
     </span>
    </button>;
   })}
  </div>
  <p className="worker-hosted-calendar__legend"><span><i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--shift" aria-hidden="true"/>{c.work}</span><span><i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--absence" aria-hidden="true"/>{c.absence}</span><span><i className="worker-hosted-calendar__mark worker-hosted-calendar__mark--planned" aria-hidden="true"/>{planLabel}</span></p></>}
 </section>
 {enableTeam&&<section className="dashboard-panel quick-template-panel">
  <div className="panel-heading"><div><span className="eyebrow">{t('workflow.templates.eyebrow')}</span><h2>{t('workflow.templates.title')}</h2></div><button className="icon-button" type="button" aria-label={t('workflow.templates.add')} onClick={()=>setTemplateOpen(true)}><Plus size={17} aria-hidden="true"/></button></div>
  <div className="quick-template-list">{templates.map(v=><div className="quick-template-card" key={v.id}>
   <button className="template-apply" type="button" disabled={loading||assignment.state!=='ready'} onClick={()=>openShift(v.data)}><span className="template-icon"><Zap size={17} aria-hidden="true"/></span><span className="template-main"><strong>{v.name}</strong><small>{v.data.startTime}–{v.data.endTime}</small></span><span className="template-go">{t('workflow.templates.apply')}</span></button>
  </div>)}{!templates.length&&!loading&&team&&<p className="muted-copy">{t('workflow.templates.empty')}</p>}</div>
 </section>}
 <section className="dashboard-panel worker-day-panel" aria-labelledby={detail+'-heading'} aria-busy={loading}>
  <div id={detail} className="worker-selected-day worker-hosted-calendar__detail" aria-live="polite">
   <div className="worker-selected-day-heading"><div><span className="eyebrow">{t('workflow.worker.dayInfoTitle')}</span><h3 id={detail+'-heading'}>{dateText.format(new Date(selected+'T12:00:00Z'))}</h3></div>
    <div className="form-actions">
     <button type="button" className="button button--primary button--small" disabled={loading||assignment.state!=='ready'} onClick={()=>openShift()}><Plus size={15} aria-hidden="true"/>{t('workflow.worker.recordForDate')}</button>
     {!loading&&!!(detailRecords.shifts.length||detailRecords.absences.length||detailRecords.plans.length)&&<Link className="button button--quiet button--small" to={root+'/timecards?month='+selected.slice(0,7)+'&date='+selected}>{t('workflow.history.open')}</Link>}
    </div>
   </div>
   {!loading&&assignment.state!=='ready'&&<p className="muted-copy">{shiftCopy[assignment.state]}</p>}
   {saved&&<p role="status">{t('timecards.saved')}</p>}
   {reviewPending===selected&&<p role="status">{shiftCopy.requestSent}</p>}
   {!loading&&!detailRecords.shifts.length&&!detailRecords.absences.length&&!detailRecords.plans.length&&(!partial||internal||factory||team)&&<p>{c.empty}</p>}
   {detailRecords.shifts.map(s=><p key={s.source+s.id}><strong>{s.data.startTime} – {s.data.endTime}</strong>{s.site?' · '+s.site:''} · {t((s.source==='internal'?'timecards.':'factoryHours.')+s.status)}</p>)}
   {detailRecords.absences.map(a=><p key={a.id}>{c.absence}{a.site?' · '+a.site:''}{a.to!==a.from?' · '+a.from+' – '+a.to:''}</p>)}
   {detailRecords.plans.map(p=><p key={p.id}>{planLabel} · {p.start} - {p.end}{p.site?' · '+p.site:''}</p>)}
  </div>
  {loading&&<p role="status">{t('timecards.checking')}</p>}
  {partial&&<p role="status">{c.partial}</p>}
  <button type="button" className="button button--outline" disabled={loading} onClick={()=>refresh(n=>n+1)}>{t('timecards.refresh')}</button>
 </section>
 {templateOpen&&<WorkerTemplateDrawer organizationId={organizationId} onClose={()=>setTemplateOpen(false)}/>}
 {entry&&<WorkerQuickShift organizationId={organizationId} {...entry} onClose={()=>setEntry(undefined)} onSaved={(day,pending)=>{setSelected(day);setMonth(monthOf(day));setSaved(!pending);setReviewPending(pending?day:undefined);setEntry(undefined)}}/>}
 {absenceDay&&<RightDrawer eyebrow={t('workflow.absence.eyebrow')} title={t('workflow.absence.reportTitle')} titleId={absenceHeading} onClose={()=>setAbsenceDay(undefined)}>
  <TeamPanel organizationId={organizationId} section="absence" initialDay={absenceDay} compact/>
 </RightDrawer>}
 </>;
}

