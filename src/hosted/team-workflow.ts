import {useCallback,useEffect,useState} from 'react';
import {isWorkerLocal} from './worker-enrollment';
export type TeamEntry={id:string;kind:'message'|'absence'|'schedule';siteId:string|null;payload:Record<string,string|number>;state:string;revision:number;sender:string;outgoing:boolean;read:boolean;createdAt:string;recipientCount:number|null;recipients:string[]};
export type AgencyPlan={id:string;siteId:string;localDate:string;startTime:string;endTime:string;state:string;recipients:string[]};
export type ShiftTemplate={id:string;name:string;revision:number;data:{startTime:string;endTime:string;breakMinutes:number;breakTreatment:'paid'|'unpaid'}};
export type TeamContext={organizationId:string;membershipId:string;role:string;unread:number;sites:{id:string;name:string;canPlan:boolean}[];recipients:{id:string;role:string;organizationName:string;organizationId:string;worksiteIds:string[]}[];entries:TeamEntry[];agencySchedule?:AgencyPlan[];templates:ShiftTemplate[];invitations:{id:string;email:string;state:string;expiresAt:string}[]};
export async function teamCall(org:string|undefined,action:string,body?:unknown,signal?:AbortSignal){
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('closed');
 const r=await fetch('/api/team/'+(org?org+'/':'')+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'conflict':r.status===400?'invalid':'closed');
 return r.json();
}
export function changed(){window.dispatchEvent(new Event('timeax-team-changed'))}
export function useTeam(org:string){
 const [value,setValue]=useState<TeamContext>(),[error,setError]=useState('loading'),[revision,R]=useState(0);
 const refresh=useCallback(()=>R(n=>n+1),[]);
 useEffect(()=>{const c=new AbortController();setError('loading');
 void teamCall(org,'context',undefined,c.signal).then(v=>{
  if(v.organizationId!==org||!Array.isArray(v.entries)||!Array.isArray(v.templates)||!Array.isArray(v.recipients)||!Array.isArray(v.sites)||!Number.isInteger(v.unread))throw Error('closed');
  if(!c.signal.aborted){setValue(v);setError('')}
 }).catch(e=>{if(!c.signal.aborted){setValue(undefined);setError(e.message)}});return()=>c.abort()},[org,revision]);
 useEffect(()=>{const visible=()=>{if(!document.hidden)refresh()};window.addEventListener('timeax-team-changed',refresh);window.addEventListener('focus',visible);const interval=setInterval(visible,30000);return()=>{window.removeEventListener('timeax-team-changed',refresh);window.removeEventListener('focus',visible);clearInterval(interval)}},[refresh]);
 return {value,error,refresh};
}
