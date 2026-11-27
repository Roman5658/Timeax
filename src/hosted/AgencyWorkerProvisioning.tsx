import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {workerCall} from './worker-enrollment';
import {workerProvisionCopy} from './worker-provisioning-copy';

type Directory={available:boolean;enabled:boolean;verified:boolean};
export function AgencyWorkerProvisioning({organizationId}:{organizationId:string}){
 const {i18n}=useTranslation(),label=workerProvisionCopy(i18n.resolvedLanguage),api='agency/'+organizationId;
 const [email,E]=useState(''),[status,S]=useState(''),[error,X]=useState(''),[saving,B]=useState(false),[directory,D]=useState<Directory>();
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{
  const c=new AbortController();
  void workerCall(api+'/directory',undefined,c.signal).then(res=>{
   if(c.signal.aborted)return;
   const v=res as Directory;
   if(typeof v?.enabled==='boolean'&&typeof v?.available==='boolean'&&typeof v?.verified==='boolean')D(v);
  }).catch(()=>{});
  return()=>{c.abort();active.current?.abort()};
 },[api]);
 async function run(path:string,data:object,done:(response:unknown)=>void){
  if(active.current)return;
  const c=new AbortController();active.current=c;B(true);S('');X('');
  try{const res=await workerCall(api+'/'+path,data,c.signal);if(!c.signal.aborted)done(res)}
  catch{if(!c.signal.aborted)X(label.unavailable)}
  finally{if(!c.signal.aborted)B(false);active.current=null}
 }
 function add(e:FormEvent){
  e.preventDefault();if(!email.trim())return;
  void run('provision',{email:email.trim()},res=>{
   if((res as {state?:unknown})?.state!=='prepared')throw Error('unavailable');
   E('');S(label.prepared);
  });
 }
 return <section className="agency-book-section">
  <h3>{label.prepare}</h3><p>{label.info}</p>
  <form className="auth-form" onSubmit={add}>
   <label className="field-label">{label.email}<input type="email" required maxLength={254} value={email} disabled={saving} onChange={e=>E(e.target.value)}/></label>
   <button className="button button--primary" disabled={saving}>{label.prepare}</button>
  </form>
  {directory?.available&&<label className="agency-worker-confirm">
   <input type="checkbox" checked={directory.enabled} disabled={saving} onChange={e=>void run('directory',{enabled:e.target.checked},res=>{
    const v=res as Directory;if(typeof v?.enabled!=='boolean')throw Error('unavailable');D(v);S(label.save);
   })}/>{label.discover}</label>}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
