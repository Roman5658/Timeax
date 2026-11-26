import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {TopBar} from '../../components/TopBar';
import {StagingSessionPanel} from '../auth/pages/StagingSessionPanel';
import {LeaderLoginPanel} from './LeaderAccess';
import {createFactoryClient,FactoryError} from './factory-client';
import '../../styles/membership-hours.css';
import './connected-factory.css';

type Worker={id:string;name:string;agencyId:string;agencyName:string};
type Connection={factoryId:string;factoryName:string;agencyId:string;agencyName:string};
type Placement={id:string;factoryId:string;factoryName:string;agencyId:string;agencyName:string;workerName:string;startDate:string;state:'pending'|'accepted'|'declined'|'cancelled';assignmentId:string|null;canAccept:boolean;canCancel:boolean};
type Context={localOnly:true;csrf:string;workers:Worker[];connections:Connection[];requests:Placement[]};

export function FactoryAssignmentPage({section}:{section:'agency'|'factory'|'worker'}){
 const {t}=useTranslation(),tx=(k:string)=>t('factoryPlacement.'+k);
 const api=useMemo(()=>createFactoryClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [ctx,setCtx]=useState<Context>(),[reload,setReload]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('checking');
 const [membershipId,setMembershipId]=useState(''),[factoryId,setFactoryId]=useState(''),[startDate,setStartDate]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [consents,setConsents]=useState<Record<string,boolean>>({});
 const mounted=useRef(false),operation=useRef<AbortController|null>(null);
 const refresh=useCallback(()=>{setCtx(undefined);setReload(x=>x+1)},[]);
 async function load(signal:AbortSignal){
  if(!api)throw new FactoryError(403,'closed');
  const v=await api.request<Context>('/placements/context',signal);
  if(v.localOnly!==true||typeof v.csrf!=='string'||![v.workers,v.connections,v.requests].every(Array.isArray))throw new FactoryError(503,'unavailable');
  return v;
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort()}},[]);
 useEffect(()=>{const c=new AbortController();setNotice('checking');void load(c.signal).then(v=>{if(!c.signal.aborted){setCtx(v);setNotice('ready')}}).catch(e=>{if(!c.signal.aborted){setCtx(undefined);setNotice(e instanceof FactoryError?e.message:'unavailable')}});return()=>c.abort()},[api,reload,section]);
 async function act(action:string,input:object){
  if(!api||!ctx||operation.current)return;const c=new AbortController();operation.current=c;setBusy(true);
  try{await api.request('/placements/'+action,c.signal,input,ctx.csrf);const v=await load(c.signal);if(!c.signal.aborted&&mounted.current){setCtx(v);setNotice('saved')}}
  catch(e){if(!c.signal.aborted&&mounted.current){setNotice(e instanceof FactoryError?e.message:'unavailable');if(e instanceof FactoryError&&e.status===403)setCtx(undefined)}}
  finally{if(operation.current===c)operation.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}
 }
 const worker=ctx?.workers.find(w=>w.id===membershipId),connections=ctx?.connections.filter(c=>c.agencyId===worker?.agencyId)??[];
 return <><TopBar/><main className="membership-main">
  <section className="membership-card"><h1>{tx(section+'Title')}</h1><p>{t('factoryOnboarding.local')}</p><p>{tx('scope')}</p>
   {section==='factory'?<LeaderLoginPanel onChanged={refresh}/>:<StagingSessionPanel purpose="existing" audience="workspace" onChanged={refresh}/>}
   <p role="status">{t('factoryOnboarding.'+notice)}</p>
   <button className="button button--outline" disabled={busy} onClick={refresh}>{t('localWorkspace.refresh')}</button>
   <nav className="factory-links">
    {section==='agency'&&<><Link to="/agency/workers">{t('localWorkspace.agencyTitle')}</Link><Link to="/agency/factory-connections">{t('factoryOnboarding.connectionsTitle')}</Link><Link to="/agency/monthly-timesheets">{t('agencyArchive.title')}</Link></>}
    {section==='factory'&&<><Link to="/factory/connections">{t('factoryOnboarding.connectionsTitle')}</Link><Link to="/factory/leaders">{t('leaderAccess.manage')}</Link></>}
    {section==='worker'&&<Link to="/worker/work">{tx('openHours')}</Link>}
   </nav>
  </section>
  {ctx&&section==='agency'&&<section className="membership-card">
   <form className="auth-form" onSubmit={e=>{e.preventDefault();void act('propose',{membershipId,factoryId,startDate,confirmed:true})}}>
    <label className="field-label"><span>{tx('worker')}</span><select id="placement-worker" required disabled={busy} value={membershipId} onChange={e=>{setMembershipId(e.target.value);setFactoryId('');setConfirmed(false)}}>
     <option value="">{tx('select')}</option>{ctx.workers.map(w=><option key={w.id} value={w.id}>{w.name} — {w.agencyName}</option>)}
    </select></label>
    <label className="field-label"><span>{t('connectedFactory.factory')}</span><select id="placement-factory" required disabled={busy||!worker} value={factoryId} onChange={e=>{setFactoryId(e.target.value);setConfirmed(false)}}>
     <option value="">{tx('select')}</option>{connections.map(c=><option key={c.factoryId} value={c.factoryId}>{c.factoryName}</option>)}
    </select></label>
    <label className="field-label"><span>{tx('startDate')}</span><input id="placement-start" type="date" required disabled={busy} value={startDate} onChange={e=>{setStartDate(e.target.value);setConfirmed(false)}}/></label>
    <label className="checkbox-field"><input type="checkbox" required disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{tx('agencyConsent')}</span></label>
    <button className="button button--primary" disabled={busy||!worker||!factoryId||!startDate||!confirmed}>{tx('propose')}</button>
   </form>
   {(!ctx.workers.length||!ctx.connections.length)&&<p>{tx('prerequisite')}</p>}
  </section>}
  {ctx&&<section className="membership-card"><h2>{tx('requests')}</h2>{!ctx.requests.length&&<p>{t('localWorkspace.empty')}</p>}
   {ctx.requests.map(r=><article className="membership-record" key={r.id}>
    <h3>{r.workerName}</h3><p>{r.agencyName} — {r.factoryName}</p><p>{tx('startDate')}: {r.startDate}</p><p>{tx(r.state)}</p>
    {section==='factory'&&r.canAccept&&<>
     <label className="checkbox-field"><input type="checkbox" disabled={busy} checked={consents[r.id]??false} onChange={e=>setConsents(v=>({...v,[r.id]:e.target.checked}))}/><span>{tx('factoryConsent')}</span></label>
     <button className="button button--primary" disabled={busy||!consents[r.id]} onClick={()=>void act('accept',{id:r.id,confirmed:true})}>{tx('accept')}</button>
     <button className="button button--outline" disabled={busy} onClick={()=>void act('decline',{id:r.id})}>{tx('decline')}</button>
    </>}
    {section==='agency'&&r.canCancel&&<button className="button button--outline" disabled={busy} onClick={()=>void act('cancel',{id:r.id})}>{tx('cancel')}</button>}
   </article>)}
  </section>}
 </main></>;
}
