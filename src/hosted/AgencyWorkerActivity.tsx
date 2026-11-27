import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {factoryHoursCall} from './factory-timecards';
import {teamCall} from './team-workflow';
import {minutesLabel,timecardCall} from './timecards';
import {selectInternalWorkerShifts,selectReceivedWorkerShifts,selectWorkerAbsences,type ActivityShift,type WorkerActivityScope} from './agency-worker-activity';
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
const absences:Load<ReturnType<typeof selectWorkerAbsences>>=async(scope,signal)=>
 selectWorkerAbsences(await teamCall(scope.organizationId,'context',undefined,signal),scope);

function useActivity<T>({organizationId,membershipId,siteId}:WorkerActivityScope,enabled:boolean,load:Load<T>){
 const [attempt,refresh]=useState(0);
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
 return {result:result?.key===key?result.data:{state:'loading'} as const,retry:()=>refresh(n=>n+1)};
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
export function AgencyWorkerActivity({scope,timecardsEnabled,factoryHoursEnabled,absencesEnabled}:{
 scope:WorkerActivityScope;timecardsEnabled:boolean;factoryHoursEnabled:boolean;absencesEnabled:boolean;
}){
 const {i18n}=useTranslation(),lang=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof copy,labels=copy[lang]??copy.en;
 const displayDate=new Intl.DateTimeFormat(lang,{timeZone:'UTC',dateStyle:'medium'});
 const format=(day:string)=>displayDate.format(new Date(day+'T00:00:00Z'));
 const shifts=useActivity(scope,timecardsEnabled,internal),received=useActivity(scope,factoryHoursEnabled,factory),reports=useActivity(scope,absencesEnabled,absences);
 const [limit,setLimit]=useState(12);
 function feedback({result,retry}:{result:LoadState<unknown>;retry:()=>void}){
  return result.state==='loading'?<p role="status">{labels.loading}</p>:result.state==='failed'?<div className="agency-worker-status">
   <p role="alert">{labels.unavailable}</p><button className="button button--outline button--small" type="button" onClick={retry}>{labels.again}</button>
  </div>:null;
 }
 if(!timecardsEnabled&&!factoryHoursEnabled&&!absencesEnabled)return <p>{labels.noHistory}</p>;
 return <div className="agency-worker-activity">
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
