import {useCallback,useEffect,useState} from 'react';
import {workerCall} from './worker-enrollment';

export type PendingApplication={application_id:string;claimed_at:string};
export function useAgencyApplications(organizationId:string|undefined){
 const [data,setData]=useState<{org:string;rows:PendingApplication[]}>(),[error,setError]=useState<string>(),[revision,R]=useState(0);
 const refresh=useCallback(()=>R(n=>n+1),[]);
 useEffect(()=>{
  if(!organizationId)return;
  const c=new AbortController();
  void workerCall('agency/'+organizationId,undefined,c.signal).then(result=>{
   const rows=(result as {applications?:PendingApplication[]})?.applications;
   if(!Array.isArray(rows)||rows.some(row=>!row||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(row.application_id)||!Number.isFinite(Date.parse(row.claimed_at))))throw Error();
   if(!c.signal.aborted){setData({org:organizationId,rows});setError(undefined)}
  }).catch(()=>{if(!c.signal.aborted)setError(organizationId)});
  return()=>c.abort();
 },[organizationId,revision]);
 useEffect(()=>{
  if(!organizationId)return;
  const wake=()=>{if(!document.hidden)refresh()};
  const timer=window.setInterval(wake,30000);window.addEventListener('focus',wake);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',wake)};
 },[organizationId,refresh]);
 const rows=organizationId&&data?.org===organizationId?data.rows:undefined;
 return {rows,failed:!!organizationId&&error===organizationId,refresh,remove(id:string){
  setData(v=>v&&v.org===organizationId?{...v,rows:v.rows.filter(row=>row.application_id!==id)}:v);
  refresh();
 }};
}
