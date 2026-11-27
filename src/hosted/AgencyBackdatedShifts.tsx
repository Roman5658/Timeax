import {useCallback,useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {timecardCall} from './timecards';
import {useMemberNames} from './MemberNames';

type Notice={id:string;source:'internal'|'factory';workerId:string;day:string;submittedAt:string;read:boolean};
type Request={id:string;workerId:string;day:string;startTime:string;endTime:string;site:string;submittedAt:string;state:'pending'|'approved'|'rejected'};
type Feed={notices:Notice[];unread:number;requests:Request[];pending:number};
const id=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const clock=(v:unknown)=>typeof v==='string'&&/^\d{2}:\d{2}$/.test(v);
function count(n:number){return Number.isSafeInteger(n)&&n>=0}
const copy={
 en:['Backdated shifts','Worker entered hours for an earlier date. Please review.','Shifts awaiting review','Approve hours','Reject request','Approved','Rejected','Could not complete this action. Refresh and try again.','Submitted','Confirm this shift for the timesheet?','Reject these hours?'],
 ru:['Смены задним числом','Работник внёс часы задним числом. Обратите внимание.','Смены на подтверждение','Подтвердить часы','Отклонить заявку','Подтверждено','Отклонено','Не удалось выполнить действие. Обновите страницу и попробуйте снова.','Внесено','Подтвердить эту смену и добавить её в табель?','Отклонить эти часы?'],
 pl:['Zmiany wpisane wstecz','Pracownik wpisał godziny wstecz. Sprawdź wpis.','Zmiany do weryfikacji','Zatwierdź godziny','Odrzuć zgłoszenie','Zatwierdzono','Odrzucono','Nie udało się wykonać działania. Odśwież stronę i spróbuj ponownie.','Wpisano','Zatwierdzić zmianę i dodać ją do ewidencji?','Odrzucić te godziny?'],
 uk:['Зміни заднім числом','Працівник вніс години заднім числом. Зверніть увагу.','Зміни на підтвердження','Підтвердити години','Відхилити заявку','Підтверджено','Відхилено','Не вдалося виконати дію. Оновіть сторінку та спробуйте знову.','Внесено','Підтвердити зміну та додати її до табеля?','Відхилити ці години?'],
};
export function useBackdatedShifts(organizationId:string|undefined){
 const [data,setData]=useState<{org:string;feed:Feed}>(),[version,setVersion]=useState(0);
 const refresh=useCallback(()=>setVersion(n=>n+1),[]);
 useEffect(()=>{
  if(!organizationId)return;
  const c=new AbortController();
  void Promise.all(['backdated-list','earlier-list'].map(action=>timecardCall(organizationId,action,undefined,c.signal))).then(([n,r])=>{
   const a=n as {entries:Notice[];unread:number},b=r as {entries:Request[];pending:number};
   const common=(e:Notice|Request)=>id(e?.id)&&id(e.workerId)&&day(e.day)&&Number.isFinite(Date.parse(e.submittedAt));
   if(!count(a?.unread)||!count(b?.pending)||!Array.isArray(a.entries)||a.entries.length>50||!Array.isArray(b.entries)||b.entries.length>50||
    !a.entries.every(e=>common(e)&&['internal','factory'].includes(e.source)&&typeof e.read==='boolean')||
    !b.entries.every(e=>common(e)&&typeof e.site==='string'&&clock(e.startTime)&&clock(e.endTime)&&['pending','approved','rejected'].includes(e.state)))throw Error();
   if(!c.signal.aborted)setData({org:organizationId,feed:{notices:a.entries,unread:a.unread,requests:b.entries,pending:b.pending}});
  }).catch(()=>{if(!c.signal.aborted)setData(undefined)});
  return()=>c.abort();
 },[organizationId,version]);
 useEffect(()=>{
  if(!organizationId)return;
  const wake=()=>{if(!document.hidden)refresh()};
  window.addEventListener('focus',wake);const timer=window.setInterval(wake,30000);
  return()=>{window.removeEventListener('focus',wake);window.clearInterval(timer)};
 },[organizationId,refresh]);
 return {feed:data?.org===organizationId?data?.feed:undefined,refresh};
}
export function AgencyBackdatedShifts({organizationId,feed,refresh}:{organizationId:string;feed:Feed;refresh:()=>void}){
 const {t,i18n}=useTranslation(),c=copy[(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof copy]??copy.en;
 const {label}=useMemberNames(organizationId),[busy,B]=useState(false),[error,E]=useState(false);
 const when=new Intl.DateTimeFormat(i18n.resolvedLanguage,{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Warsaw'});
 async function action(kind:string,input:{id:string;source?:Notice['source']},expected:string){
  if(busy)return;B(true);E(false);
  try{
   const r=await timecardCall(organizationId,kind,input) as {read?:boolean;id?:string;state?:string};
   if(expected==='read'?r?.read!==true:r?.state!==expected||r?.id!==input.id)throw Error();
   refresh();
  }catch{E(true)}finally{B(false)}
 }
 if(!feed.notices.length&&!feed.requests.length)return null;
 return <section className="dashboard-panel agency-worker-group">
  {!!feed.requests.length&&<><h2>{c[2]}</h2><ul>{feed.requests.map(e=><li key={e.id}>
   <div><strong>{label(e.workerId)}</strong><p>{e.site} · {e.day} · {e.startTime}–{e.endTime}</p><p>{c[8]}: {when.format(new Date(e.submittedAt))}</p></div>
   {e.state==='pending'?<div className="form-actions team-template-tools">
    <button type="button" className="button button--primary button--small" disabled={busy} onClick={()=>{if(window.confirm(c[9]))void action('earlier-approve',{id:e.id},'approved')}}>{c[3]}</button>
    <button type="button" className="button button--outline button--small" disabled={busy} onClick={()=>{if(window.confirm(c[10]))void action('earlier-reject',{id:e.id},'rejected')}}>{c[4]}</button>
   </div>:<span>{c[e.state==='approved'?5:6]}</span>}
  </li>)}</ul></>}
  {!!feed.notices.length&&<><h2>{c[0]}</h2><ul>{feed.notices.map(e=><li key={e.source+e.id}>
   <div><strong>{label(e.workerId)}</strong><p>{c[1]} · {e.day}</p><p>{c[8]}: {when.format(new Date(e.submittedAt))}</p></div>
   {!e.read&&<button type="button" className="button button--outline button--small" disabled={busy} onClick={()=>void action('backdated-read',{id:e.id,source:e.source},'read')}>{t('workflow.notifications.markRead')}</button>}
  </li>)}</ul></>}
  {error&&<p role="alert">{c[7]}</p>}
 </section>;
}
