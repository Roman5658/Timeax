import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {timecardCall,parseTimecards,minutesLabel,type TimecardContext} from './timecards';
import {factoryHoursCall,parseFactoryHours,type FactoryHoursContext} from './factory-timecards';
import {teamCall,type TeamContext} from './team-workflow';
import {workerCalendarCopy} from './worker-calendar-copy';
import {workerShiftCopy} from './worker-shift-copy';
import {calendarDate,workerCalendarRecords} from './worker-calendar-data';
import {workerHistoryDays,workerHistoryMonth} from './worker-shift-history';
import '../styles/worker-history-hosted.css';

type Revision={revision:number;reason:string;data:{localDate:string;startTime:string;endTime:string}};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function WorkerShiftHistory({organizationId,membershipId,enableInternal=true,enableFactory=true,enableTeam=true}:{
 organizationId:string;membershipId:string;enableInternal?:boolean;enableFactory?:boolean;enableTeam?:boolean;
}){
 const {t,i18n}=useTranslation(),calendar=workerCalendarCopy(i18n.language),shift=workerShiftCopy(i18n.language);
 const [params,setParams]=useSearchParams();
 const _month=params.get('month'),month=workerHistoryMonth(_month)?_month:today().slice(0,7);
 const _day=params.get('date'),focusDay=calendarDate(_day)&&_day.startsWith(month+'-')?_day:undefined;
 const anchor=useId(),focus=useRef<HTMLElement|null>(null),historyController=useRef<AbortController|null>(null);
 const [revision,refresh]=useState(0),[loading,setLoading]=useState(true),[partial,setPartial]=useState(false);
 const [internal,I]=useState<TimecardContext>(),[factory,F]=useState<FactoryHoursContext>(),[team,T]=useState<TeamContext>();
 const [history,H]=useState<{shiftId:string;state:'loading'|'ready'|'failed';rows?:Revision[]}>();
 const root='/workspace/'+organizationId;
 useEffect(()=>{
  const ctl=new AbortController();
  const exact=<T extends {organizationId:string;membershipId:string;role:string},>(v:T)=>{
   if(v.organizationId!==organizationId||v.membershipId!==membershipId||v.role!=='worker')throw Error('unavailable');
   return v;
  };
  setLoading(true);setPartial(false);I(undefined);F(undefined);T(undefined);
  void Promise.allSettled([
   enableInternal?timecardCall(organizationId,'context',undefined,ctl.signal).then(v=>exact(parseTimecards(v,organizationId))):Promise.resolve(undefined),
   enableFactory?factoryHoursCall(organizationId,'context',undefined,ctl.signal).then(v=>exact(parseFactoryHours(v,organizationId))):Promise.resolve(undefined),
   enableTeam?teamCall(organizationId,'context',undefined,ctl.signal).then((v:TeamContext)=>{
    if(!Array.isArray(v.entries)||!Array.isArray(v.sites))throw Error('unavailable');
    return exact(v);
   }):Promise.resolve(undefined),
  ]).then(([a,b,c])=>{
   if(ctl.signal.aborted)return;
   if(a.status==='fulfilled')I(a.value);
   if(b.status==='fulfilled')F(b.value);
   if(c.status==='fulfilled')T(c.value);
   setPartial([a,b,c].some(r=>r.status==='rejected'));setLoading(false);
  });
  return()=>ctl.abort();
 },[organizationId,membershipId,revision,enableInternal,enableFactory,enableTeam]);

 useEffect(()=>()=>historyController.current?.abort(),[organizationId,membershipId]);
 useEffect(()=>{
  const update=()=>refresh(n=>n+1);
  window.addEventListener('timeax-timecards-changed',update);
  window.addEventListener('timeax-team-changed',update);
  return()=>{window.removeEventListener('timeax-timecards-changed',update);window.removeEventListener('timeax-team-changed',update)};
 },[]);
 useEffect(()=>{
  if(!loading&&focusDay&&focus.current){focus.current.focus({preventScroll:true});focus.current.scrollIntoView({block:'nearest'})}
 },[focusDay,loading]);
 const records=useMemo(()=>workerCalendarRecords({organizationId,membershipId,internal,factory,team}),[organizationId,membershipId,internal,factory,team]);
 const days=workerHistoryDays(month,records);
 const dateFormatter=new Intl.DateTimeFormat(i18n.resolvedLanguage||'pl',{dateStyle:'full',timeZone:'UTC'});
 function selectMonth(next:string){
  if(!workerHistoryMonth(next))return;
  historyController.current?.abort();H(undefined);
  const q=new URLSearchParams(params);q.set('month',next);q.delete('date');setParams(q);
 }
 function moveMonth(delta:number){
  const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+delta);selectMonth(date.toISOString().slice(0,7));
 }
 async function showHistory(id:string){
  historyController.current?.abort();if(history?.shiftId===id){H(undefined);return}
  const ctrl=new AbortController();historyController.current=ctrl;H({shiftId:id,state:'loading'});
  try{
   const result=await timecardCall(organizationId,'history/'+id,undefined,ctrl.signal) as {revisions?:Revision[]};
   const rows=result?.revisions;
   if(!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(r?.revision)||r.revision<1||
    typeof r.reason!=='string'||!calendarDate(r.data?.localDate)||typeof r.data.startTime!=='string'||typeof r.data.endTime!=='string'))throw Error();
   if(!ctrl.signal.aborted)H({shiftId:id,state:'ready',rows:[...rows].sort((a,b)=>b.revision-a.revision)});
  }catch{if(!ctrl.signal.aborted)H({shiftId:id,state:'failed'})}
 }
 const paid=days.flatMap(d=>d.shifts).reduce((sum,row)=>sum+row.data.paidMinutes,0);
 return <section className="dashboard-panel worker-history-hosted" aria-labelledby={anchor} aria-busy={loading}>
  <div className="panel-heading"><h2 id={anchor}>{t('workflow.history.open')}</h2>
   <div className="form-actions">
    <Link className="button button--outline button--small" to={root}>{shift.back}</Link>
    {enableFactory&&<Link className="button button--outline button--small" to={root+'/factory-timecards'}>{t('factoryHours.title')}</Link>}
   </div>
  </div>
  <div className="worker-history-hosted__controls">
   <button className="icon-button" type="button" aria-label={t('workflow.calendar.previous')} onClick={()=>moveMonth(-1)}><ChevronLeft size={18} aria-hidden="true"/></button>
   <label className="field-label"><span>{t('exports.periodMonth')}</span><input type="month" value={month} onChange={e=>selectMonth(e.target.value)}/></label>
   <button className="icon-button" type="button" aria-label={t('workflow.calendar.next')} onClick={()=>moveMonth(1)}><ChevronRight size={18} aria-hidden="true"/></button>
  </div>
  {loading&&<p role="status">{t('timecards.checking')}</p>}
  {partial&&<p role="status">{calendar.partial}</p>}
  {!loading&&!partial&&!days.length&&<p>{shift.monthEmpty}</p>}
  {!!days.length&&<p className="muted-copy">{t('workflow.calendar.periodHours',{hours:minutesLabel(paid)})}</p>}
  {days.map(d=><article key={d.day} ref={d.day===focusDay?focus:undefined} tabIndex={d.day===focusDay?-1:undefined} className="worker-history-hosted__day">
   <h3>{dateFormatter.format(new Date(d.day+'T12:00:00Z'))}</h3>
   {d.shifts.map(row=><section className="notice-box" key={row.source+row.id}>
    <strong>{row.data.startTime} – {row.data.endTime}</strong>
    <p>{row.site&&row.site+' · '}{t((row.source==='internal'?'timecards.':'factoryHours.')+row.status)} · {t('timecards.counted')}: {minutesLabel(row.data.paidMinutes)}</p>
    <p>{t('timecards.break')}: {row.data.breakStatus==='not-reported'?t('workflow.breakReport.notReported'):row.data.breakStatus==='not-taken'?t('breaks.notTaken'):row.data.breakTreatment==='paid'?t('workflow.breakReport.paidChoice'):t('workflow.breakReport.unpaidChoice')+' · '+minutesLabel(row.data.breakMinutes)}</p>
    {row.data.comment&&<p>{row.data.comment}</p>}
    {row.source==='internal'&&<><button className="button button--outline button--small" type="button" aria-expanded={history?.shiftId===row.id} onClick={()=>void showHistory(row.id)}>{t('timecards.history')}</button>
     {history?.shiftId===row.id&&<div className="worker-history-hosted__revisions" aria-live="polite">
      {history.state!=='ready'?<p>{t('timecards.'+(history.state==='loading'?'checking':'unavailable'))}</p>:history.rows?.map(v=><p key={v.revision}>{t('timecards.version')} {v.revision}: {v.data.localDate} · {v.data.startTime} – {v.data.endTime} · {v.reason==='created'?t('timecards.created'):v.reason}</p>)}
     </div>}
    </>}
   </section>)}
   {d.absences.map(absence=><p className="inline-notice" key={absence.id}>{calendar.absence}{absence.site?' · '+absence.site:''}</p>)}
   {d.plans.map(plan=><p className="inline-notice" key={plan.id}>{t('team.planned')}:  {plan.start} – {plan.end}{plan.site?' · '+plan.site:''}</p>)}
  </article>)}
  <button className="button button--outline" type="button" disabled={loading} onClick={()=>refresh(n=>n+1)}>{t('timecards.refresh')}</button>
 </section>;
}
