import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';import {useTranslation} from 'react-i18next';import {isWorkerLocal} from './worker-enrollment';import {workerLabelText} from './member-label';
import {readWithRetry,retryableStatus,TemporaryReadError} from './retry-read.ts';
export type MemberName={membershipId:string;organizationId:string;organizationName:string;reference:string;name:string|null;revision:number;state:string;checkedAt:string|null};
type Context={organizationId:string;canEdit:boolean;workers:MemberName[]};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export async function memberNamesCall(org:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(!uuid(org)||location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/member-names/'+org+'/'+(body===undefined?'context':'set'),{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(body===undefined&&retryableStatus(r.status))throw new TemporaryReadError();
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'conflict':'unavailable');if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
export function parseMemberNames(v:unknown,org:string):Context{
 const c=v as Context;if(!c||c.organizationId!==org||typeof c.canEdit!=='boolean'||!Array.isArray(c.workers)||c.workers.some(w=>!uuid(w.membershipId)||!uuid(w.organizationId)||!/^[1-9][0-9]*$/.test(w.reference)||w.name!==null&&(typeof w.name!=='string'||[...w.name].length>120)||!Number.isSafeInteger(w.revision)))throw Error('unavailable');return c;
}
const sharedRead=createContext<{org:string;context?:Context;state:string;ensure:()=>void;refresh:()=>void}|undefined>(undefined);
function useMemberNamesRead(org:string|undefined){
 const [snapshot,C]=useState<{org:string;context?:Context;state:string}>();
 const running=useRef<AbortController|null>(null),lastStarted=useRef(-Infinity),trailing=useRef(false);
 const load=useCallback((force:boolean)=>{
  if(!org)return;
  if(running.current){if(force)trailing.current=true;return}
  if(!force&&Date.now()-lastStarted.current<20000)return;
  lastStarted.current=Date.now();
  const controller=new AbortController();running.current=controller;
  C(v=>({org,context:v?.org===org?v.context:undefined,state:'checking'}));
  void readWithRetry(async signal=>parseMemberNames(await memberNamesCall(org,undefined,signal),org),controller.signal,1)
   .then(context=>{if(!controller.signal.aborted)C({org,context,state:'ready'})},error=>{
    if(!controller.signal.aborted)C(v=>({org,context:v?.org===org&&!['login','denied'].includes(error?.message)?v.context:undefined,state:'unavailable'}));
   }).finally(()=>{
    if(running.current!==controller)return;
    running.current=null;
    if(trailing.current){trailing.current=false;load(true)}
   });
 },[org]);
 useEffect(()=>()=>{running.current?.abort();running.current=null;lastStarted.current=-Infinity;trailing.current=false},[org]);
 const ensure=useCallback(()=>load(false),[load]),refresh=useCallback(()=>load(true),[load]);
 return {context:org&&snapshot?.org===org?snapshot.context:undefined,state:org&&snapshot?.org===org?snapshot.state:'checking',ensure,refresh};
}
export function MemberNamesProvider({org,enabled,prefetch,children}:{org:string;enabled:boolean;prefetch:boolean;children:ReactNode}){
 const value=useMemberNamesRead(enabled?org:undefined);
 const {ensure}=value;
 useEffect(()=>{if(prefetch)ensure()},[prefetch,ensure]);
 return <sharedRead.Provider value={{org,...value}}>{children}</sharedRead.Provider>;
}
export function useMemberNames(org:string|undefined,revision=0){
 const {t}=useTranslation(),source=useContext(sharedRead);
 const local=useMemberNamesRead(source?.org===org?undefined:org);
 const {context,state,ensure,refresh}=source?.org===org?source??local:local;
 const previous=useRef({org,revision});
 useEffect(()=>{
  const before=previous.current;previous.current={org,revision};
  if(!org)return;
  if(before.org===org&&before.revision!==revision)refresh();else ensure();
 },[org,revision,ensure,refresh]);
 const byId=useMemo(()=>new Map(context?.workers.map(w=>[w.membershipId,w])),[context]);
 const label=(id:string)=>{const w=byId.get(id);return workerLabelText(w?{...w,source:'current'}:undefined,t('memberNames.missing'),t('memberNames.reference'))};
 const organizationLabel=(id:string)=>byId.get(id)?.organizationName??'';
 return {context,state,label,organizationLabel};
}
export function MemberNamesPanel({organizationId,revision=0,onChanged}:{organizationId:string;revision?:number;onChanged?:()=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t('memberNames.'+k),[refresh,R]=useState(0),{context,state,label}=useMemberNames(organizationId,revision+refresh),[member,M]=useState(''),[name,N]=useState(''),[confirmed,C]=useState(false),[busy,B]=useState(false),[notice,S]=useState('');
 const current=context?.workers.find(w=>w.membershipId===member&&w.organizationId===organizationId&&w.state==='active');
 useEffect(()=>{M('');N('');C(false);S('')},[organizationId]);
 return <details className="notice-box"><summary>{tx('title')}</summary><p>{tx('lead')}</p>{!context?<p role="status">{tx(state)}</p>:context.canEdit?<form className="auth-form" onSubmit={e=>{e.preventDefault();if(!current||!confirmed||busy)return;B(true);S('');void memberNamesCall(organizationId,{membershipId:member,name:name.trim(),revision:current.revision,confirmed:true,operationId:crypto.randomUUID()}).then(()=>{S('saved');C(false);R(n=>n+1);onChanged?.()}).catch(()=>{S('uncertain');C(false);R(n=>n+1)}).finally(()=>B(false))}}>
 <label className="field-label">{tx('worker')}<select value={member} required disabled={busy} onChange={e=>{const w=context.workers.find(w=>w.membershipId===e.target.value);M(e.target.value);N(w?.name??'');C(false)}}><option value="">{tx('choose')}</option>{context.workers.filter(w=>w.organizationId===organizationId&&w.state==='active').map(w=><option key={w.membershipId} value={w.membershipId}>{label(w.membershipId)}</option>)}</select></label>
 <label className="field-label">{tx('name')}<input value={name} minLength={2} maxLength={120} required autoComplete="off" disabled={busy} onChange={e=>{N(e.target.value);C(false)}}/></label>
 <label className="timecards-check"><input type="checkbox" checked={confirmed} disabled={busy||!current} onChange={e=>C(e.target.checked)}/>{tx('confirm')}</label>
 <button className="button button--outline button--full" disabled={busy||!current||!confirmed||name.trim().length<2}>{tx('save')}</button><p>{tx('snapshotHint')}</p>
 </form>:<p>{tx('denied')}</p>}{notice&&<p role={notice==='saved'?'status':'alert'}>{tx(notice)}</p>}</details>;
}
