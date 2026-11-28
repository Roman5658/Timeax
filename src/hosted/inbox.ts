import {useCallback,useEffect,useRef,useState} from 'react';
import {readWithRetry,retryableStatus,TemporaryReadError} from './retry-read.ts';
import {bellTarget,isActionNotice} from './notification-navigation.ts';
import type {JoinEvent} from './AgencyJoinNotifications';
import type {Notice as ShiftNotice,Request as ShiftRequest} from './AgencyBackdatedShifts';
export type Disposition='active'|'archived'|'deleted';
type States=Record<string,Exclude<Disposition,'active'>>;
type InboxData={membershipId:string;states:States;joins:JoinEvent[];backdated:ShiftNotice[];requests:ShiftRequest[]};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const day=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const nullable=(v:unknown)=>v===null||typeof v==='string';
async function request(org:string,body?:Record<string,string>,signal?:AbortSignal){
 const response=await fetch('/api/inbox/'+org+(body?'/set':'/context'),{
  method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
  ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
 });
 if(!body&&retryableStatus(response.status))throw new TemporaryReadError();
 if(response.status===401||response.status===403)throw Error('denied');
 if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('Inbox unavailable');
 return response.json();
}
export const inboxPageSize=10;
export function inboxPage<T>(rows:readonly T[],requested:number){
 const pages=Math.max(1,Math.ceil(rows.length/inboxPageSize));
 const page=Math.max(0,Math.min(requested,pages-1));
 return {page,pages,rows:rows.slice(page*inboxPageSize,(page+1)*inboxPageSize)};
}
export function useInbox(org:string,membershipId:string,enabled:boolean){
 const [data,setData]=useState<InboxData>(),[revision,R]=useState(0),[failure,setFailure]=useState(false),[loadFailed,setLoadFailed]=useState(false);
 const [busy,setBusy]=useState(false),scope=useRef<string|undefined>(undefined),pending=useRef(false),reading=useRef(false),updated=useRef(0);
 const refresh=useCallback(()=>R(n=>n+1),[]);
 const key=org+'/'+membershipId;
 useEffect(()=>{scope.current=key;pending.current=false;setBusy(false);setFailure(false);setLoadFailed(false);return()=>{scope.current=undefined}},[key]);
 useEffect(()=>{
  if(!enabled)return;
  const c=new AbortController(),version=updated.current;reading.current=true;
  void readWithRetry(signal=>request(org,undefined,signal),c.signal,1).then((v:InboxData)=>{
   if(v?.membershipId!==membershipId||!v.states||Array.isArray(v.states)||typeof v.states!=='object'||
    Object.entries(v.states).some(([k,s])=>!bellTarget('#'+k)||isActionNotice(k)||k.startsWith('payslip-')||s!=='archived'&&s!=='deleted')||
    !Array.isArray(v.joins)||!v.joins.every(e=>uuid(e?.id)&&date(e.joinedAt)&&nullable(e.name)&&nullable(e.reference)&&typeof e.read==='boolean')||
    !Array.isArray(v.requests)||!v.requests.every(e=>uuid(e?.id)&&uuid(e.workerId)&&day(e.day)&&date(e.submittedAt)&&typeof e.site==='string'&&['pending','approved','rejected'].includes(e.state)&&/^\d{2}:\d{2}$/.test(e.startTime)&&/^\d{2}:\d{2}$/.test(e.endTime))||
    !Array.isArray(v.backdated)||!v.backdated.every(e=>uuid(e?.id)&&uuid(e.workerId)&&['internal','factory'].includes(e.source)&&day(e.day)&&date(e.submittedAt)&&typeof e.read==='boolean'))throw Error();
   if(!c.signal.aborted&&updated.current===version){setData(v);setLoadFailed(false)}
  }).catch(error=>{if(!c.signal.aborted&&updated.current===version){if(error.message==='denied')setData(undefined);setLoadFailed(true)}}).finally(()=>{if(!c.signal.aborted)reading.current=false});
  return()=>{c.abort();reading.current=false};
 },[enabled,org,membershipId,revision]);
 useEffect(()=>{
  if(!enabled)return;
  const wake=()=>{if(!document.hidden&&!reading.current)refresh()};
  const timer=window.setInterval(wake,30000);window.addEventListener('focus',wake);window.addEventListener('online',wake);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',wake);window.removeEventListener('online',wake)};
 },[enabled,refresh]);
 const current=enabled&&data?.membershipId===membershipId?data:undefined;
 async function set(anchor:string,state:Disposition){
  if(!current||pending.current||!bellTarget('#'+anchor)||isActionNotice(anchor)||anchor.startsWith('payslip-'))return;
  pending.current=true;setBusy(true);setFailure(false);updated.current++;
  try{
   const r=await request(org,{kind:anchor.slice(0,-37),id:anchor.slice(-36),state});
   if(r.state!==state)throw Error();
   if(scope.current!==key)return;
   setData(v=>{
    if(!v||v.membershipId!==membershipId)return v;
    const states={...v.states};if(state==='active')delete states[anchor];else states[anchor]=state;
    return {...v,states};
   });
  }catch{if(scope.current===key)setFailure(true)}
  finally{if(scope.current===key){pending.current=false;setBusy(false);refresh()}}
 }
 return {data:current,busy,failure:failure||loadFailed,loadFailed,enabled,set,refresh,state:(anchor:string):Disposition=>current?.states[anchor]??'active'};
}
export type Inbox=ReturnType<typeof useInbox>;
