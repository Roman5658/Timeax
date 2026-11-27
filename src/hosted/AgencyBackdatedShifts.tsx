import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {bellTarget,useBellAnchor,type BellPreview} from './notification-navigation';
import {timecardCall} from './timecards';
import {useMemberNames} from './MemberNames';
import {InboxPagination} from './InboxControls';
import {inboxPage,inboxPageSize} from './inbox';
import {groupShiftReviews,type ShiftReviewState} from './shift-review';

export type Notice={id:string;source:'internal'|'factory';workerId:string;day:string;submittedAt:string;read:boolean};
export type Request={id:string;workerId:string;day:string;startTime:string;endTime:string;site:string;submittedAt:string;state:'pending'|'approved'|'rejected'};
export type Feed={notices:Notice[];unread:number;requests:Request[];pending:number};
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
export function useBackdatedShifts(organizationId:string|undefined,poll=true){
 const [data,setData]=useState<{org:string;feed:Feed}>(),[version,setVersion]=useState(0);
 const refresh=useCallback(()=>setVersion(n=>n+1),[]);
 useEffect(()=>{
  if(!organizationId||!poll)return;
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
 },[organizationId,version,poll]);
 useEffect(()=>{
  if(!organizationId||!poll)return;
  const wake=()=>{if(!document.hidden)refresh()};
  window.addEventListener('focus',wake);const timer=window.setInterval(wake,30000);
  return()=>{window.removeEventListener('focus',wake);window.clearInterval(timer)};
 },[organizationId,refresh,poll]);
 return {feed:data?.org===organizationId?data?.feed:undefined,refresh};
}
export function agencyShiftPreviews(feed:Feed|undefined,language:string|undefined):BellPreview[]{
 if(!feed)return [];
 const c=copy[(language??'en').split('-')[0] as keyof typeof copy]??copy.en;
 return [...feed.requests.filter(e=>e.state==='pending').map(e=>({anchor:'earlier-shift-'+e.id,title:c[2],summary:e.site+' · '+e.day+' · '+e.startTime+'–'+e.endTime,at:e.submittedAt,unread:e.state==='pending'})),
  ...feed.notices.map(e=>({anchor:'backdated-'+e.source+'-'+e.id,title:c[0],summary:c[1]+' · '+e.day,at:e.submittedAt,unread:!e.read}))];
}
const sectionCopy={
 en:{pending:'Shifts awaiting review',approved:'Approved shifts',rejected:'Rejected shifts',empty:'No shifts in this list.',history:'History shows up to 50 of the most recent decisions.'},
 ru:{pending:'Смены на подтверждение',approved:'Подтверждённые смены',rejected:'Отклонённые смены',empty:'В этом списке пока нет смен.',history:'В истории показываются до 50 последних решений.'},
 pl:{pending:'Zmiany do zatwierdzenia',approved:'Zatwierdzone zmiany',rejected:'Odrzucone zmiany',empty:'Brak zmian na tej liście.',history:'Historia obejmuje do 50 ostatnich decyzji.'},
 uk:{pending:'Зміни на підтвердження',approved:'Підтверджені зміни',rejected:'Відхилені зміни',empty:'У цьому списку поки немає змін.',history:'В історії показано до 50 останніх рішень.'},
};
export function AgencyBackdatedShifts({organizationId,feed,refresh}:{organizationId:string;feed:Feed;refresh:()=>void}){
 useBellAnchor(true);
 const {i18n}=useTranslation(),lang=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof copy,c=copy[lang]??copy.en,w=sectionCopy[lang]??sectionCopy.en;
 const {hash,key}=useLocation(),lastLink=useRef('');
 const [pages,P]=useState<Record<ShiftReviewState,number>>({pending:0,approved:0,rejected:0});
 const groups=useMemo(()=>groupShiftReviews(feed.requests),[feed.requests]);
 useEffect(()=>{
  if(lastLink.current===key)return;
  const anchor=bellTarget(hash);
  if(!anchor?.startsWith('earlier-shift-'))return;
  for(const state of ['pending','approved','rejected'] as const){
   const position=groups[state].findIndex(e=>'earlier-shift-'+e.id===anchor);
   if(position<0)continue;
   lastLink.current=key;P(previous=>({...previous,[state]:Math.floor(position/inboxPageSize)}));break;
  }
 },[groups,hash,key]);
 const {label}=useMemberNames(organizationId),[busy,B]=useState(false),[error,E]=useState(false);
 const when=new Intl.DateTimeFormat(i18n.resolvedLanguage,{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Warsaw'});
 async function action(kind:string,input:{id:string},expected:string){
  if(busy)return;B(true);E(false);
  try{
   const r=await timecardCall(organizationId,kind,input) as {id?:string;state?:string};
   if(r?.state!==expected||r?.id!==input.id)throw Error();
   refresh();
  }catch{E(true)}finally{B(false)}
 }
 if(!feed.requests.length)return null;
 return <div className="agency-shift-reviews">
  {(['pending','approved','rejected'] as const).map(state=>{
   if(state==='rejected'&&!groups.rejected.length)return null;
   const current=inboxPage(groups[state],pages[state]);
   return <section key={state} className="dashboard-panel agency-worker-group agency-shift-review" data-review-state={state} aria-label={w[state]}>
    <h2>{w[state]}{current.rows.length>0&&<small> ({state==='pending'?feed.pending:groups[state].length})</small>}</h2>
    {current.rows.length>0?<ul>{current.rows.map(e=><li key={e.id} id={'earlier-shift-'+e.id} tabIndex={-1}>
     <div><strong>{label(e.workerId)}</strong><p>{e.site} · {e.day} · {e.startTime}–{e.endTime}</p><p>{c[8]}: {when.format(new Date(e.submittedAt))}</p></div>
     {state==='pending'&&<div className="form-actions team-template-tools">
      <button type="button" className="button button--primary button--small" disabled={busy} onClick={()=>{if(window.confirm(c[9]))void action('earlier-approve',{id:e.id},'approved')}}>{c[3]}</button>
      <button type="button" className="button button--outline button--small" disabled={busy} onClick={()=>{if(window.confirm(c[10]))void action('earlier-reject',{id:e.id},'rejected')}}>{c[4]}</button>
     </div>}
    </li>)}</ul>:<p>{w.empty}</p>}
    {state==='pending'&&error&&<p role="alert">{c[7]}</p>}
    <InboxPagination page={current.page} pages={current.pages} onPage={page=>P(previous=>({...previous,[state]:page}))}/>
   </section>;
  })}
  {groups.approved.length+groups.rejected.length>=50&&<p className="muted-copy">{w.history}</p>}
 </div>;
}
