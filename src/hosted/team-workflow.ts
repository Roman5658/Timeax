import {useCallback,useEffect,useState} from 'react';
import {isWorkerLocal} from './worker-enrollment';
export type TeamEntry={id:string;kind:'message'|'absence'|'schedule';siteId:string|null;payload:Record<string,string|number>;state:string;revision:number;sender:string;outgoing:boolean;read:boolean;createdAt:string;recipientCount:number|null;recipients:string[]};
export type AgencyPlan={id:string;siteId:string;localDate:string;startTime:string;endTime:string;state:string;recipients:string[]};
export type ShiftTemplate={id:string;name:string;revision:number;data:{startTime:string;endTime:string;breakMinutes:number;breakTreatment:'paid'|'unpaid'}};
export type TeamContext={organizationId:string;membershipId:string;role:string;unread:number;sites:{id:string;name:string;canPlan:boolean}[];recipients:{id:string;role:string;organizationName:string;organizationId:string;worksiteIds:string[]}[];entries:TeamEntry[];agencySchedule?:AgencyPlan[];templates:ShiftTemplate[];invitations:{id:string;email:string;state:string;expiresAt:string}[]};
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
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'conflict':r.status===400?'invalid':'closed');
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('closed');
 const data=await r.json();
 if(!data||typeof data!=='object'||Array.isArray(data)||!validReceipt(action,data))throw Error('closed');
 return data;
}
export function changed(){window.dispatchEvent(new Event('timeax-team-changed'))}
export function useTeam(org:string){
 const [value,setValue]=useState<TeamContext>(),[error,setError]=useState('loading'),[revision,R]=useState(0);
 const refresh=useCallback(()=>R(n=>n+1),[]);
 useEffect(()=>{const c=new AbortController();setError('loading');
 void teamCall(org,'context',undefined,c.signal).then(v=>{
  if(v.organizationId!==org||!id(v.membershipId)||!['worker','agency_admin','team_leader','accountant'].includes(v.role)
   ||!Array.isArray(v.entries)||!Array.isArray(v.templates)||!v.templates.every(validTemplate)||!Array.isArray(v.recipients)
   ||!Array.isArray(v.sites)||!Array.isArray(v.invitations)||!Number.isSafeInteger(v.unread)||v.unread<0)throw Error('closed');
  if(!c.signal.aborted){setValue(v);setError('')}
 }).catch(e=>{if(!c.signal.aborted){setValue(undefined);setError(e.message)}});return()=>c.abort()},[org,revision]);
 useEffect(()=>{const visible=()=>{if(!document.hidden)refresh()};window.addEventListener('timeax-team-changed',refresh);window.addEventListener('focus',visible);const interval=setInterval(visible,30000);return()=>{window.removeEventListener('timeax-team-changed',refresh);window.removeEventListener('focus',visible);clearInterval(interval)}},[refresh]);
 return {value:value?.organizationId===org?value:undefined,error,refresh};
}
