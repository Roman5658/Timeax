import {createContext,createElement,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {readWithRetry,retryableStatus,TemporaryReadError} from './retry-read.ts';
import {isWorkerLocal} from './worker-enrollment';
export type TeamEntry={id:string;kind:'message'|'absence'|'schedule';siteId:string|null;payload:Record<string,string|number>;state:string;revision:number;sender:string;outgoing:boolean;read:boolean;createdAt:string;recipientCount:number|null;recipients:string[]};
export type AgencyPlan={id:string;siteId:string;localDate:string;startTime:string;endTime:string;state:string;recipients:string[]};
export type ShiftTemplate={id:string;name:string;revision:number;data:{startTime:string;endTime:string;breakMinutes:number;breakTreatment:'paid'|'unpaid'}};
export type TeamContext={organizationId:string;membershipId:string;role:string;unread:number;messageThreads?:boolean;factoryChat?:boolean;absenceComments?:boolean;sites:{id:string;name:string;canPlan:boolean}[];recipients:{id:string;role:string;organizationName:string;organizationId:string;worksiteIds:string[]}[];entries:TeamEntry[];agencySchedule?:AgencyPlan[];templates:ShiftTemplate[];invitations:{id:string;email:string;state:string;expiresAt:string}[]};
const id=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const revision=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const time=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function validTemplate(v:ShiftTemplate){
 return v&&id(v.id)&&typeof v.name==='string'&&v.name.trim().length>0&&revision(v.revision)&&v.data&&
  time(v.data.startTime)&&time(v.data.endTime)&&v.data.startTime!==v.data.endTime&&
  Number.isInteger(v.data.breakMinutes)&&v.data.breakMinutes>=0&&v.data.breakMinutes<=720&&['paid','unpaid'].includes(v.data.breakTreatment);
}
function validReceipt(action:string,v:Record<string,unknown>){
 switch(action){
  case 'context':return true;
  case 'read':return v.read===true;
  case 'message':case 'absence':case 'schedule':case 'update-plan':return id(v.id)&&revision(v.revision)&&v.state==='active';
  case 'cancel':return id(v.id)&&revision(v.revision)&&v.state==='cancelled';
  case 'save-template':return id(v.id)&&revision(v.revision);
  case 'delete-template':return v.deleted===true;
  case 'invite-accountant':return id(v.id)&&v.state==='pending'&&typeof v.code==='string'&&/^[a-f0-9]{64}$/.test(v.code);
  case 'revoke-accountant':return v.state==='revoked';
  case 'accept-accountant':return v.state==='accepted'&&id(v.organizationId);
  default:return false;
 }
}
export async function teamCall(org:string|undefined,action:string,body?:unknown,signal?:AbortSignal){
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('closed');
 const r=await fetch('/api/team/'+(org?org+'/':'')+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(action==='context'&&retryableStatus(r.status))throw new TemporaryReadError();
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'conflict':r.status===400?'invalid':'closed');
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('closed');
 const data=await r.json();
 if(!data||typeof data!=='object'||Array.isArray(data)||!validReceipt(action,data))throw Error('closed');
 return data;
}
export function changed(){window.dispatchEvent(new Event('timeax-team-changed'))}
type TeamSnapshot={value?:TeamContext;error:string};
const loading={error:'loading'};
const TeamRead=createContext<{org:string;value?:TeamContext;error:string;refresh:()=>void}|undefined>(undefined);
export function TeamContextProvider({org,membershipId,enabled=true,children}:{org:string;membershipId?:string;enabled?:boolean;children:ReactNode}){
 const [snapshot,save]=useState<TeamSnapshot>(loading);
 const active=useRef<AbortController|null>(null),dirty=useRef(false);
 const refresh=useCallback((afterWrite=false)=>{
  if(!enabled)return;
  if(active.current){if(afterWrite)dirty.current=true;return}
  const c=new AbortController();active.current=c;
  save(current=>current.value?current:loading);
  void readWithRetry(async signal=>{
   const v=await teamCall(org,'context',undefined,signal);
   if(v.organizationId!==org||!id(v.membershipId)||membershipId&&v.membershipId!==membershipId)throw Error('denied');
   if(v.absenceComments!==undefined&&typeof v.absenceComments!=='boolean'||v.messageThreads!==undefined&&typeof v.messageThreads!=='boolean'||v.factoryChat!==undefined&&typeof v.factoryChat!=='boolean'
    ||!['worker','agency_admin','team_leader','accountant','factory_admin'].includes(v.role)||v.role==='factory_admin'&&v.factoryChat!==true
    ||!Array.isArray(v.entries)||!Array.isArray(v.templates)||!v.templates.every(validTemplate)||!Array.isArray(v.recipients)
    ||!Array.isArray(v.sites)||!Array.isArray(v.invitations)||!Number.isSafeInteger(v.unread)||v.unread<0)throw Error('closed');
   return v as TeamContext;
  },c.signal,1).then(v=>{if(!c.signal.aborted)save({value:v,error:''})},e=>{
   if(c.signal.aborted)return;
   const error=['login','denied'].includes(e?.message)?e.message:'unavailable';
   save(current=>({error,value:error==='unavailable'?current.value:undefined}));
  }).finally(()=>{
   if(active.current!==c)return;
   active.current=null;
   // A write may complete after the read started. Re-read once, never fan out.
   if(dirty.current){dirty.current=false;refresh()}
  });
 },[enabled,org,membershipId]);
 useEffect(()=>{
  if(!enabled){save(loading);return}
  const visible=()=>{if(!document.hidden&&!active.current)refresh()};
  const changed=()=>refresh(true);
  refresh();
  window.addEventListener('timeax-team-changed',changed);window.addEventListener('focus',visible);
  window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);
  const interval=window.setInterval(visible,30000);
  return()=>{window.removeEventListener('timeax-team-changed',changed);window.removeEventListener('focus',visible);
   window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);
   window.clearInterval(interval);active.current?.abort();active.current=null;dirty.current=false;};
 },[enabled,refresh]);
 const value=enabled&&snapshot.value?.organizationId===org&&(!membershipId||snapshot.value.membershipId===membershipId)?snapshot.value:undefined;
 return createElement(TeamRead.Provider,{value:{org,value,error:snapshot.error,refresh:()=>refresh()}},children);
}
const noop=()=>{};
export function useTeam(org:string){
 const state=useContext(TeamRead);
 return state?.org===org?state:{...loading,value:undefined,refresh:noop};
}
