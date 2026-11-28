import {useCallback,useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {BellPreview} from './notification-navigation';
import {workerCall} from './worker-enrollment';

export type JoinEvent={id:string;joinedAt:string;name:string|null;reference:string|null;read:boolean};
type JoinFeed={entries:JoinEvent[];unread:number};
const copy={
 ru:['Подключения работников','Работник','Подключился к агентству','Отметить прочитанным','Отметить не удалось. Попробуй ещё раз.'],
 pl:['Dołączenia pracowników','Pracownik','Dołączył do agencji','Oznacz jako przeczytane','Nie udało się oznaczyć. Spróbuj ponownie.'],
 uk:['Підключення працівників','Працівник','Підключився до агенції','Позначити прочитаним','Не вдалося позначити. Спробуй ще раз.'],
 en:['Worker connections','Worker','Joined the agency','Mark as read','Could not mark this as read. Try again.'],
};
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
export function useAgencyJoinNotifications(organizationId:string|undefined,poll=true){
 const [state,setState]=useState<{org:string;value:JoinFeed}>();
 const [revision,R]=useState(0);
 const refresh=useCallback(()=>R(n=>n+1),[]);
 useEffect(()=>{
  if(!organizationId||!poll)return;
  const controller=new AbortController();
  void workerCall('agency/'+organizationId+'/joins',undefined,controller.signal).then(v=>{
   const d=v as JoinFeed;
   if(!Array.isArray(d?.entries)||d.entries.length>50||!Number.isSafeInteger(d.unread)||d.unread<0||d.entries.some(e=>!uuid(e?.id)||typeof e.read!=='boolean'||!Number.isFinite(Date.parse(e.joinedAt))||(e.name!==null&&typeof e.name!=='string')||(e.reference!==null&&typeof e.reference!=='string')))throw Error();
   if(!controller.signal.aborted)setState({org:organizationId,value:d});
  }).catch(()=>{if(!controller.signal.aborted)setState(undefined)});
  return()=>controller.abort();
 },[organizationId,revision,poll]);
 useEffect(()=>{
  if(!organizationId||!poll)return;
  const visible=()=>{if(!document.hidden)refresh()};
  window.addEventListener('focus',visible);const id=window.setInterval(visible,30000);
  return()=>{window.removeEventListener('focus',visible);window.clearInterval(id)};
 },[organizationId,refresh,poll]);
 async function mark(id:string){
  if(!organizationId)return;
  const res=await workerCall('agency/'+organizationId+'/joins',{id}) as {state?:string};
  if(res.state!=='read')throw Error();refresh();
 }
 return {value:state?.org===organizationId?state?.value:undefined,refresh,mark};
}

export function agencyJoinPreviews(feed:JoinFeed|undefined,language:string|undefined):BellPreview[]{
 const lang=language?.split('-')[0] as keyof typeof copy;
 const c=copy[lang]??copy.en;
 return feed?.entries.map(e=>({anchor:'agency-join-'+e.id,title:c[0],summary:e.name??(c[1]+(e.reference?' #'+e.reference:'')),at:e.joinedAt,unread:!e.read}))??[];
}

export function useAgencyJoinCards(mark:(id:string)=>Promise<void>){
 const {i18n}=useTranslation(),language=i18n.resolvedLanguage?.split('-')[0];
 const c=copy[language==='ru'||language==='pl'||language==='uk'?language:'en'];
 const date=new Intl.DateTimeFormat(i18n.resolvedLanguage??'en',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Warsaw'});
 const [busy,B]=useState<string>(),[error,E]=useState(false);
 async function read(id:string){if(busy)return;B(id);E(false);try{await mark(id)}catch{E(true)}finally{B(undefined)}}
 return {read,error:error?c[4]:undefined,card:(e:JoinEvent)=><>
   <h3>{c[0]}</h3>
   <div><strong>{e.name??(c[1]+(e.reference?' #'+e.reference:''))}</strong><p>{c[2]} · {date.format(new Date(e.joinedAt))}</p></div>
   {!e.read&&<button type="button" className="button button--outline button--small" disabled={!!busy} onClick={()=>void read(e.id)}>{c[3]}</button>}
  </>};
}
