import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {factoryHoursCall,type FactoryHoursContext} from './factory-timecards';
import {useTeam} from './team-workflow';
import {minutesLabel,timecardCall} from './timecards';
import {selectInternalWorkerShifts,selectReceivedWorkerShifts,selectWorkerAbsences,type ActivityShift,type WorkerActivityScope} from './agency-worker-activity';
import {loadPayEstimateSettings} from './pay-estimate-settings';
import {applicableEstimate,warsawEstimateMonth} from './worker-pay-estimate-form';
import {agencyPayEstimates} from './agency-pay-estimate';
import {payEstimateCopy} from './pay-estimate-copy';
import './agency-worker-activity.css';

const copy={
 en:{internal:'Hours · internal sites',factory:'Hours · received factory timecards',absences:'Reported absences',noneHours:'No shifts recorded in this section.',noneAbsences:'No absences reported.',paid:'Paid hours',shifts:'Shifts',cancelled:'Cancelled',reported:'Reported',unavailable:'This section is unavailable.',loading:'Loading…',again:'Retry',more:'Show more',noHistory:'Hours and absence history are not available for this account.'},
 pl:{internal:'Godziny · zakłady wewnętrzne',factory:'Godziny · otrzymane ewidencje z fabryk',absences:'Zgłoszone nieobecności',noneHours:'Brak zmian w tej sekcji.',noneAbsences:'Nie zgłoszono nieobecności.',paid:'Płatne godziny',shifts:'Zmiany',cancelled:'Anulowane',reported:'Zgłoszone',unavailable:'Ta sekcja jest niedostępna.',loading:'Wczytywanie…',again:'Spróbuj ponownie',more:'Pokaż więcej',noHistory:'Historia godzin i nieobecności jest niedostępna dla tego konta.'},
 ru:{internal:'Часы · внутренние производства',factory:'Часы · полученные табели заводов',absences:'Сообщения об отсутствии',noneHours:'В этом разделе нет записанных смен.',noneAbsences:'Об отсутствии не сообщалось.',paid:'Часы к оплате',shifts:'Смены',cancelled:'Отменено',reported:'Сообщено',unavailable:'Этот раздел недоступен.',loading:'Загрузка…',again:'Повторить',more:'Показать ещё',noHistory:'История часов и отсутствий недоступна для этого аккаунта.'},
 uk:{internal:'Години · внутрішні виробництва',factory:'Години · отримані табелі заводів',absences:'Повідомлення про відсутність',noneHours:'У цьому розділі немає записаних змін.',noneAbsences:'Про відсутність не повідомляли.',paid:'Години до оплати',shifts:'Зміни',cancelled:'Скасовано',reported:'Повідомлено',unavailable:'Цей розділ недоступний.',loading:'Завантаження…',again:'Спробувати ще раз',more:'Показати ще',noHistory:'Історія годин і відсутностей недоступна для цього облікового запису.'},
};
type Words=typeof copy.en;
type Load<T>=(scope:WorkerActivityScope,signal:AbortSignal)=>Promise<T>;
type LoadState<T>={state:'loading'|'failed'}|{state:'ready';value:T};
const internal:Load<ReturnType<typeof selectInternalWorkerShifts>>=async(scope,signal)=>
 selectInternalWorkerShifts(await timecardCall(scope.organizationId,'context',undefined,signal),scope);
const factory:Load<ReturnType<typeof selectReceivedWorkerShifts>>=async(scope,signal)=>
 selectReceivedWorkerShifts(await factoryHoursCall(scope.organizationId,'context',undefined,signal),scope);

function useActivity<T>({organizationId,membershipId,siteId}:WorkerActivityScope,enabled:boolean,load:Load<T>){
 const [attempt,refresh]=useState(0);
 const retry=useCallback(()=>refresh(n=>n+1),[]);
 const key=[organizationId,membershipId,siteId,attempt].join('/');
 const [result,setResult]=useState<{key:string;data:LoadState<T>}>();
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  void load({organizationId,membershipId,siteId},controller.signal).then(value=>{
   if(!controller.signal.aborted)setResult({key,data:{state:'ready',value}});
  }).catch(()=>{
   if(!controller.signal.aborted)setResult({key,data:{state:'failed'}});
  });
  return()=>controller.abort();
 },[key,organizationId,membershipId,siteId,enabled,load]);
 return {result:result?.key===key?result.data:{state:'loading'} as const,retry};
}
const estimates:Load<Awaited<ReturnType<typeof loadPayEstimateSettings>>>=async(scope,signal)=>
 (await loadPayEstimateSettings(scope.organizationId,signal)).filter(r=>r.workerId===scope.membershipId);
const wageDetails={
 en:{period:'Estimate month',unconfigured:'No hourly rate set for this month.',noHours:'No internal shifts for the selected month.',source:'Internal work hours only.'},
 ru:{period:'Месяц расчёта',unconfigured:'На этот месяц ставка не задана.',noHours:'В выбранном месяце нет смен на внутренних производствах.',source:'Расчёт только по внутренним часам.'},
 pl:{period:'Miesiąc rozliczenia',unconfigured:'Na ten miesiąc nie ustawiono stawki godzinowej.',noHours:'W tym miesiącu nie ma zmian wewnętrznych.',source:'Szacunek tylko na podstawie godzin wewnętrznych.'},
 uk:{period:'Місяць розрахунку',unconfigured:'На цей місяць ставки не задано.',noHours:'У вибраному місяці немає змін на внутрішніх виробництвах.',source:'Розрахунок лише за внутрішніми годинами.'},
};
function WageCard({scope,lang,rows,hoursEnabled,settings,feedback}:{
 scope:WorkerActivityScope;lang:keyof typeof wageDetails;rows?: ActivityShift[];hoursEnabled:boolean;
 settings:ReturnType<typeof useActivity<Awaited<ReturnType<typeof loadPayEstimateSettings>>>>;
 feedback:ReactNode;
}){
 const c=payEstimateCopy(lang),details=wageDetails[lang]??wageDetails.en,now=warsawEstimateMonth();
 const [selected,setSelected]=useState(now);
 const months=[...new Set([now,...(rows??[]).map(r=>r.data.localDate.slice(0,7))])].sort().reverse();
 const month=months.includes(selected)?selected:now;
 const number=new Intl.NumberFormat(lang,{style:'currency',currency:'PLN'});
 const monthLabel=new Intl.DateTimeFormat(lang,{month:'long',year:'numeric',timeZone:'UTC'});
 const source=settings.result.state==='ready'?settings.result.value:undefined;
 const rate=source&&applicableEstimate(source,scope.membershipId,month);
 const knownRows=rows?.filter(r=>r.data.localDate.startsWith(month+'-'));
 const result=source&&knownRows?.length?agencyPayEstimates({rows:knownRows.map(r=>({membershipId:scope.membershipId,data:r.data}))},source,
  !scope.siteId?month:undefined).get(scope.membershipId)?.months[0]:undefined;
 const displayNet=result?.netCents!==undefined;
 const value=displayNet?result.netCents:result?.hourlyBaseCents;
 const money=(amount:number|undefined)=>amount===undefined?'—':number.format(amount/100);
 return <section className="agency-worker-activity__section agency-worker-activity__wages"><h3>{c.title}</h3>
  {!source?feedback:<>
   <label className="field-label">{details.period}<select value={month} onChange={e=>setSelected(e.target.value)}>{months.map(m=>
    <option key={m} value={m}>{monthLabel.format(new Date(m+'-01T00:00:00Z'))}</option>)}</select></label>
   {!rate?<p>{details.unconfigured}</p>:<dl className="agency-worker-activity__summary">
    <div><dt>{c.rate} ({rate.basis==='gross'?'brutto':'netto'})</dt><dd>{money(rate.rateCents)} / h</dd></div>
    <div><dt>{displayNet||rate.basis==='net'?c.net:c.gross}</dt><dd>{money(value)}</dd></div>
   </dl>}
   <p className="muted-copy">{details.source}</p>
   {result&&result.status!=='direct-net'&&result.status!=='gross-with-deductions'?<p className="muted-copy">{c[result.status]}</p>:
    rate&&knownRows?.length===0?<p className="muted-copy">{details.noHours}</p>:rate&&(!hoursEnabled||!rows)?<p className="muted-copy">{(copy[lang]??copy.en).unavailable}</p>:null}
  </>}
 </section>;
}
function Hours({rows,labels,format}:{rows:ActivityShift[];labels:Words;format:(day:string)=>string}){
 const [limit,setLimit]=useState(12);
 if(!rows.length)return <p className="muted-copy">{labels.noneHours}</p>;
 return <>
  <dl className="agency-worker-activity__summary">
   <div><dt>{labels.paid}</dt><dd>{minutesLabel(rows.reduce((sum,row)=>sum+row.data.paidMinutes,0))}</dd></div>
   <div><dt>{labels.shifts}</dt><dd>{rows.length}</dd></div>
  </dl>
  <ul className="agency-worker-activity__rows">{rows.slice(0,limit).map(({id,siteName,data})=><li key={id}>
   <div><strong><time dateTime={data.localDate}>{format(data.localDate)}</time></strong>{siteName&&<span>{siteName}</span>}</div>
   <div><b>{minutesLabel(data.paidMinutes)}</b><span>{data.startTime}–{data.endTime}</span></div>
  </li>)}</ul>
  {rows.length>limit&&<button className="button button--outline button--small" type="button" onClick={()=>setLimit(n=>n+12)}>{labels.more}</button>}
 </>;
}
export function AgencyWorkerActivity({scope,timecardsEnabled,factoryHoursEnabled,factoryContext,factoryLoading,absencesEnabled,estimatesEnabled=false}:{
 scope:WorkerActivityScope;timecardsEnabled:boolean;factoryHoursEnabled:boolean;factoryContext?:FactoryHoursContext;factoryLoading:boolean;absencesEnabled:boolean;estimatesEnabled?:boolean;
}){
 const {i18n}=useTranslation(),lang=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof copy,labels=copy[lang]??copy.en;
 const displayDate=new Intl.DateTimeFormat(lang,{timeZone:'UTC',dateStyle:'medium'});
 const format=(day:string)=>displayDate.format(new Date(day+'T00:00:00Z'));
 const {organizationId,membershipId,siteId}=scope;
 const team=useTeam(organizationId);
 const shifts=useActivity(scope,timecardsEnabled,internal);
 const [reloadFactory,setReloadFactory]=useState(false);
 const factoryFallback=useActivity(scope,factoryHoursEnabled&&(reloadFactory||!factoryContext&&!factoryLoading),factory);
 const receivedData=useMemo<LoadState<ActivityShift[]>|undefined>(()=>{
  if(!factoryContext)return undefined;
  try{return {state:'ready',value:selectReceivedWorkerShifts(factoryContext,{organizationId,membershipId,siteId})}}
  catch{return {state:'failed'}}
 },[factoryContext,organizationId,membershipId,siteId]);
 const received={result:reloadFactory?factoryFallback.result:receivedData??factoryFallback.result,retry:()=>{setReloadFactory(true);factoryFallback.retry()}};
 const reports={retry:team.refresh,result:useMemo<LoadState<ReturnType<typeof selectWorkerAbsences>>>(()=>{
  if(!team.value)return {state:team.error==='loading'?'loading':'failed'};
  try{return {state:'ready',value:selectWorkerAbsences(team.value,{organizationId,membershipId,siteId})}}
  catch{return {state:'failed'}}
 },[team.value,team.error,organizationId,membershipId,siteId])};
 const pay=useActivity(scope,estimatesEnabled,estimates);
 const {retry:refreshPay}=pay;
 useEffect(()=>{if(!estimatesEnabled)return;window.addEventListener('timeax-pay-estimate-settings-changed',refreshPay);
  return()=>window.removeEventListener('timeax-pay-estimate-settings-changed',refreshPay)
 },[estimatesEnabled,refreshPay]);
 const [limit,setLimit]=useState(12);
 function feedback({result,retry}:{result:LoadState<unknown>;retry:()=>void}){
  return result.state==='loading'?<p role="status">{labels.loading}</p>:result.state==='failed'?<div className="agency-worker-status">
   <p role="alert">{labels.unavailable}</p><button className="button button--outline button--small" type="button" onClick={retry}>{labels.again}</button>
  </div>:null;
 }
 if(!timecardsEnabled&&!factoryHoursEnabled&&!absencesEnabled&&!estimatesEnabled)return <p>{labels.noHistory}</p>;
 return <div className="agency-worker-activity">
  {estimatesEnabled&&<WageCard scope={scope} lang={lang} rows={shifts.result.state==='ready'?shifts.result.value:undefined}
   hoursEnabled={timecardsEnabled} settings={pay} feedback={feedback(pay)}/>}
  {([[timecardsEnabled,labels.internal,shifts],[factoryHoursEnabled,labels.factory,received]] as const).map(([enabled,label,source])=>enabled&&
   <section key={label} className="agency-worker-activity__section"><h3>{label}</h3>
    {source.result.state==='ready'?<Hours labels={labels} format={format} rows={source.result.value}/>:feedback(source)}
   </section>)}
  {absencesEnabled&&<section className="agency-worker-activity__section">
   <h3>{labels.absences}</h3>
   {reports.result.state!=='ready'?feedback(reports):!reports.result.value.length?<p className="muted-copy">{labels.noneAbsences}</p>:<>
    <ul className="agency-worker-activity__rows">{reports.result.value.slice(0,limit).map(row=><li key={row.id}>
     <div><strong><time dateTime={row.dateFrom}>{format(row.dateFrom)}</time>{row.dateFrom!==row.dateTo&&<> – <time dateTime={row.dateTo}>{format(row.dateTo)}</time></>}</strong>{row.siteName&&<span>{row.siteName}</span>}</div>
     <span>{row.state==='cancelled'?labels.cancelled:labels.reported}</span>
    </li>)}</ul>
    {reports.result.value.length>limit&&<button className="button button--outline button--small" type="button" onClick={()=>setLimit(n=>n+12)}>{labels.more}</button>}
   </>}
  </section>}
 </div>;
}
