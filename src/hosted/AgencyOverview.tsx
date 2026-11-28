import {useEffect,useMemo,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from 'react-router-dom';
import {Building2,ChevronLeft,ChevronRight,UsersRound} from 'lucide-react';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import type {Request} from './AgencyBackdatedShifts';
import {useMemberNames} from './MemberNames';
import {useTeam} from './team-workflow';
import {factoryCall,parseSetupContext} from './factory-enrollment';
import {factoryHoursCall,parseFactoryHours} from './factory-timecards';
import {timecardCall,parseTimecards,minutesLabel} from './timecards';
import {readWithRetry} from './retry-read';
import {agencyOverview,overviewDays} from './agency-overview';
import {warsawEstimateMonth} from './worker-pay-estimate-form';
import './agency-overview.css';

const words={
 en:['Productions','Workers','Hours','Absence days','To review','Unread messages','Internal','Connected','No productions yet.','No active workers.','Some information could not be loaded.','Retry','Worker calendar','Close','Shift','Absence','Weekend','Planned shift','Hours to review','No entries','See all productions','See all workers','More','Workers assigned','Select a day to see its entries.','Open hours review','Open messages'],
 ru:['Производства','Работники','Часы','Дни отсутствия','На проверке','Непрочитанные сообщения','Внутреннее','Подключённое','Производств пока нет.','Нет активных работников.','Часть данных не загрузилась.','Повторить','Календарь работника','Закрыть','Смена','Отсутствие','Суббота и воскресенье','Смена по графику','Часы на проверке','Нет записей','Все производства','Все работники','Показать ещё','Назначено работников','Выберите день, чтобы посмотреть записи.','Проверить часы','Открыть сообщения'],
 pl:['Zakłady','Pracownicy','Godziny','Dni nieobecności','Do sprawdzenia','Nieprzeczytane wiadomości','Wewnętrzny','Połączony','Nie ma jeszcze zakładów.','Brak aktywnych pracowników.','Nie udało się wczytać części danych.','Spróbuj ponownie','Kalendarz pracownika','Zamknij','Zmiana','Nieobecność','Weekend','Planowana zmiana','Godziny do sprawdzenia','Brak wpisów','Wszystkie zakłady','Wszyscy pracownicy','Pokaż więcej','Przypisani pracownicy','Wybierz dzień, aby zobaczyć wpisy.','Sprawdź godziny','Otwórz wiadomości'],
 uk:['Виробництва','Працівники','Години','Дні відсутності','На перевірці','Непрочитані повідомлення','Внутрішнє','Підключене','Виробництв ще немає.','Немає активних працівників.','Не вдалося завантажити частину даних.','Спробувати знову','Календар працівника','Закрити','Зміна','Відсутність','Субота й неділя','Зміна за графіком','Години на перевірці','Немає записів','Усі виробництва','Усі працівники','Показати ще','Призначено працівників','Виберіть день, щоб переглянути записи.','Перевірити години','Відкрити повідомлення'],
};
type Read<T>={data?:T;error?:true};
function useRead<T>(org:string,member:string,enabled:boolean,revision:number,read:(signal:AbortSignal)=>Promise<T>){
 const [state,setState]=useState<Read<T>>({});
 useEffect(()=>{
  if(!enabled)return;
  const c=new AbortController();setState({});
  void readWithRetry(read,c.signal,0).then(data=>{if(!c.signal.aborted)setState({data})},()=>{if(!c.signal.aborted)setState({error:true})});
  return()=>c.abort();
 // read closes over the workspace identity only.
 },[org,member,enabled,revision]);
 return enabled?state:{};
}
type Props={org:string;member:string;sites:{id:string;name:string}[];productions:boolean;names:boolean;internal:boolean;factory:boolean;teamEnabled:boolean;reviews:Request[];reviewsReady:boolean;messageStates?:Readonly<Record<string,string>>};

export function AgencyOverview({org,member,sites,productions,names,internal,factory,teamEnabled,reviews,reviewsReady,messageStates}:Props){
 const {t,i18n}=useTranslation(),lang=(i18n.resolvedLanguage??'en').split('-')[0];
 const c=words[lang as keyof typeof words]??words.en;
 const description={
  en:'Hours include internal shifts and factory timesheets already sent to your agency.',
  ru:'В часы входят внутренние смены и табели, уже полученные от производства.',
  pl:'Godziny obejmują zmiany wewnętrzne i ewidencje otrzymane z zakładów.',
  uk:'До годин входять внутрішні зміни й табелі, уже отримані від виробництва.',
 }[lang as keyof typeof words]??'Hours include internal shifts and factory timesheets already sent to your agency.';
 const [month,setMonth]=useState(warsawEstimateMonth),[revision,reload]=useState(0);
 const [siteLimit,moreSites]=useState(8),[workerLimit,moreWorkers]=useState(8);
 const [worker,open]=useState<string>(),[day,select]=useState<string>();
 const root='/workspace/'+org;
 const team=useTeam(org);
 const memberNames=useMemberNames(names?org:undefined,revision);
 const internalRead=useRead(org,member,internal,revision,async signal=>{
  const v=parseTimecards(await timecardCall(org,'context',undefined,signal),org);
  if(v.role!=='agency_admin'||v.membershipId!==member)throw Error('denied');return v;
 });
 const factoryRead=useRead(org,member,factory,revision,async signal=>{
  const v=parseFactoryHours(await factoryHoursCall(org,'context',undefined,signal),org);
  if(v.role!=='agency_admin'||v.membershipId!==member)throw Error('denied');return v;
 });
 const setup=useRead(org,member,productions,revision,async signal=>{
  const v=parseSetupContext(await factoryCall('context',undefined,signal));
  if(!v.memberships.some(x=>x.organizationId===org&&x.id===member&&x.role==='agency_admin'))throw Error('denied');return v;
 });
 const named=memberNames.context?.workers.filter(w=>w.organizationId===org);
 const roster=(named?named.filter(w=>w.state==='active').map(w=>w.membershipId):setup.data?.workers.filter(w=>w.organizationId===org).map(w=>w.id)??[]);
 const workers=[...new Set(roster)].map(id=>({id,label:memberNames.label(id)})).sort((a,b)=>a.label.localeCompare(b.label,lang));
 const active=workers.find(w=>w.id===worker);
 const summary=useMemo(()=>agencyOverview({org,member,month,initialSites:sites,setup:setup.data,internal:internalRead.data,factory:factoryRead.data,team:teamEnabled?team.value:undefined,requests:reviews,messageStates,now:Date.now()}),
  [org,member,month,sites,setup.data,internalRead.data,factoryRead.data,team.value,teamEnabled,reviews,messageStates]);
 const {offset,days}=overviewDays(month,active?summary.workers.get(active.id):undefined);
 const dateText=new Intl.DateTimeFormat(lang,{timeZone:'UTC',dateStyle:'full'});
 const title=new Intl.DateTimeFormat(lang,{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00Z'));
 const weekdays=new Intl.DateTimeFormat(lang,{weekday:'short',timeZone:'UTC'});
 const selected=days.find(d=>d.day===day);
 const kinds={shift:c[14],absence:c[15],weekend:c[16],planned:c[17],review:c[18],empty:c[19]};
 const legend=['shift','absence','weekend','planned','review'] as const;
 const error=setup.error||internalRead.error||factoryRead.error||names&&memberNames.state==='unavailable'||teamEnabled&&team.error&&team.error!=='loading';
 const loading=productions&&!setup.data&&!setup.error||internal&&!internalRead.data&&!internalRead.error||factory&&!factoryRead.data&&!factoryRead.error||names&&!named&&memberNames.state==='checking'||teamEnabled&&team.error==='loading';
 const hoursReady=(!internal||!!internalRead.data)&&(!factory||!!factoryRead.data)&&(internal||factory);
 const absenceReady=teamEnabled&&!!team.value;
 const amount=(value:number|undefined,ready:boolean)=>ready?minutesLabel(value??0):'—';
 const updateMonth=(n:number)=>{
  const base=new Date(month+'-01T12:00:00Z');base.setUTCMonth(base.getUTCMonth()+n);setMonth(base.toISOString().slice(0,7));select(undefined);
 };
 const siteMinutes=new Map<string,number>();
 for(const s of summary.shifts)siteMinutes.set(s.site,(siteMinutes.get(s.site)??0)+s.minutes);
 const sortedSites=[...summary.sites].sort((a,b)=>a.name.localeCompare(b.name,lang));
 const absencesByWorker=new Map(workers.map(w=>{
  const dates=new Set<string>();
  for(const report of summary.workers.get(w.id)?.absences??[])for(const d of days)if(report.from<=d.day&&d.day<=report.to)dates.add(d.day);
  return [w.id,dates.size];
 }));
 const pager=<div className="agency-overview__month"><button className="icon-button" type="button" aria-label={t('workflow.calendar.previous')} onClick={()=>updateMonth(-1)}><ChevronLeft size={18}/></button><strong aria-live="polite">{title}</strong><button className="icon-button" type="button" aria-label={t('workflow.calendar.next')} onClick={()=>updateMonth(1)}><ChevronRight size={18}/></button></div>;
 return <section className="agency-overview" aria-label={t('nav.agencyHome')}>
  {pager}
  <p className="muted-copy agency-overview__status">{description}</p>
  {loading&&<p role="status" className="muted-copy">{t('memberNames.checking')}</p>}
  {error&&<p role="status" className="agency-overview__status">{c[10]} <button type="button" className="button button--outline button--small" onClick={()=>{reload(n=>n+1);team.refresh()}}>{c[11]}</button></p>}
  <div className="agency-overview__panels">
   <section className="dashboard-panel">
    <div className="panel-heading"><h2><Building2 size={18}/> {c[0]}</h2><Link to={root+'/setup'}>{c[20]}</Link></div>
    <ul className="agency-overview__list">{sortedSites.slice(0,siteLimit).map(site=><li key={site.id}>
     <Link to={root+'/setup?site='+site.id}><strong>{site.name}</strong>{site.kind&&<span>{site.kind==='internal'?c[6]:c[7]}</span>}
      <div className="agency-overview__metrics"><span>{c[23]}: {setup.data&&(site.kind!=='connected'||factoryRead.data)?site.workers.size:'—'}</span><span>{c[2]}: {amount(siteMinutes.get(site.id),site.kind==='internal'?!!internalRead.data:site.kind==='connected'?!!factoryRead.data:hoursReady)}</span></div>
     </Link>
    </li>)}</ul>
    {!sortedSites.length&&!loading&&!setup.error&&<p>{c[8]}</p>}
    {sortedSites.length>siteLimit&&<button type="button" className="button button--outline button--small" onClick={()=>moreSites(n=>n+8)}>{c[22]}</button>}
   </section>
   <section className="dashboard-panel">
    <div className="panel-heading"><h2><UsersRound size={18}/> {c[1]}</h2><Link to={root+'/workers'}>{c[21]}</Link></div>
    <ul className="agency-overview__list">{workers.slice(0,workerLimit).map(w=>{
     const data=summary.workers.get(w.id);
     return <li key={w.id}><button type="button" aria-haspopup="dialog" onClick={()=>{select(undefined);open(w.id)}}>
      <strong>{w.label}</strong><div className="agency-overview__metrics">
       <span>{c[2]}: {amount(data?.shifts.reduce((n,s)=>n+s.minutes,0),hoursReady)}</span><span>{c[3]}: {absenceReady?absencesByWorker.get(w.id):'—'}</span>
       <span data-attention={!!data?.reviews.length}>{c[4]}: {reviewsReady?data?.reviews.length??0:'—'}</span>
       <span data-attention={!!data?.messages}>{c[5]}: {absenceReady?data?.messages??0:'—'}</span>
      </div>
     </button></li>;
    })}</ul>
    {!workers.length&&!loading&&(named||setup.data)&&<p>{c[9]}</p>}
    {workers.length>workerLimit&&<button type="button" className="button button--outline button--small" onClick={()=>moreWorkers(n=>n+8)}>{c[22]}</button>}
   </section>
  </div>
  {active&&<AgencyBookDrawer title={active.label+' · '+c[12]} closeLabel={c[13]} centered onClose={()=>open(undefined)}>
   {pager}
   <div className="agency-overview__legend">{legend.map(k=><span key={k} data-kind={k}>{kinds[k]}</span>)}</div>
   <div className="agency-overview__calendar">
    {Array.from({length:7},(_,i)=><span key={'weekday'+i}>{weekdays.format(new Date(Date.UTC(2026,0,5+i,12)))}</span>)}
    {Array.from({length:offset},(_,i)=><span key={'pad'+i} aria-hidden="true"/>)}
    {days.map((d,i)=><button key={d.day} type="button" data-kind={d.kind} aria-label={dateText.format(new Date(d.day+'T12:00:00Z'))+', '+kinds[d.kind]} aria-pressed={d.day===day} onClick={()=>select(d.day)}>
     {i+1}{d.minutes>0&&<small>{minutesLabel(d.minutes)}</small>}
    </button>)}
   </div>
   {selected?<div className="agency-book-section" aria-live="polite">
    <strong>{dateText.format(new Date(selected.day+'T12:00:00Z'))} · {kinds[selected.kind]}</strong>
    {selected.shifts.map(s=><p key={s.site+'/'+s.id}>{s.start}–{s.end} · {minutesLabel(s.minutes)} · {summary.sites.find(site=>site.id===s.site)?.name??''}</p>)}
    {selected.absences.map((a,i)=><p key={i}>{c[15]}{a.site&&summary.sites.find(s=>s.id===a.site)?' · '+summary.sites.find(s=>s.id===a.site)?.name:''}</p>)}
    {selected.reviews.map(r=><p key={r.id}><Link to={root+'/timecards#earlier-shift-'+r.id}>{c[25]} · {r.startTime}–{r.endTime}</Link></p>)}
   </div>:<p className="muted-copy">{c[24]}</p>}
   {!!summary.workers.get(active.id)?.messages&&<Link to={root+'/messages'}>{c[26]}</Link>}
  </AgencyBookDrawer>}
 </section>;
}
