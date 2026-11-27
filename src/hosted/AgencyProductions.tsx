import {useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {FactoryIndependencePanel} from './FactoryIndependencePanel';
import {FactoryTimecardsPanel} from './FactoryTimecardsPage';
import {useMemberNames} from './MemberNames';
import {factoryCall,parseSetupContext,type SetupContext,type SetupConnection} from './factory-enrollment';
import {productionCopy} from './agency-production-copy';

export function AgencyProductions({organizationId,initialSites,enabled,factoryInvites=false,namesEnabled=false,placementsEnabled=false}:{organizationId:string;initialSites:{id:string;name:string}[];enabled:boolean;factoryInvites?:boolean;namesEnabled?:boolean;placementsEnabled?:boolean}){
 const {t,i18n}=useTranslation(),tx=(key:string)=>t('agencyProductions.'+key),ft=(key:string)=>t('factoryEnrollment.'+key);
 const copy=productionCopy[(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof productionCopy]??productionCopy.en;
 const [search,setSearch]=useSearchParams();
 const [tab,setTab]=useState<'internal'|'connections'>('internal'),[value,setValue]=useState<SetupContext>();
 const [name,setName]=useState(''),[rename,setRename]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[loadError,setLoadError]=useState(false),[attempt,setAttempt]=useState(0);
 const [createOpen,setCreateOpen]=useState(false),[connection,setConnection]=useState<SetupConnection>();
 const [worker,setWorker]=useState(''),[starts,setStarts]=useState(new Date().toISOString().slice(0,10));
 const [newSite,setNewSite]=useState<{id:string;name:string}>();
 const {label}=useMemberNames(namesEnabled?organizationId:undefined);
 const op=useRef(crypto.randomUUID()),pending=useRef(false);
 useEffect(()=>{
  if(!enabled)return;
  const request=new AbortController();setLoadError(false);
  void factoryCall('context',undefined,request.signal).then(parseSetupContext).then(c=>{
   if(!c.memberships.some(m=>m.organizationId===organizationId&&m.role==='agency_admin'))throw Error('denied');
   if(!request.signal.aborted){setValue(c);setNewSite(undefined)}
  }).catch(()=>{if(!request.signal.aborted)setLoadError(true)});
  return()=>request.abort();
 },[enabled,organizationId,attempt]);
 const sites=value?value.worksites.filter(w=>w.ownerId===organizationId&&w.organizationId===organizationId):initialSites;
 const siteId=search.get('site');
 const site=sites.find(w=>w.id===siteId)??(newSite?.id===siteId?newSite:undefined);
 const connections=value?.connections.filter(c=>c.agencyId===organizationId)??[];
 const current=new Date();
 const assignments=value?.assignments.filter(a=>a.organizationId===organizationId&&a.state==='active'&&(!a.endsAt||Date.parse(a.endsAt)>current.getTime()))??[];
 const here=assignments.filter(a=>a.worksiteId===siteId);
 const workers=value?.workers.filter(w=>w.organizationId===organizationId)??[];
 const available=workers.filter(w=>!here.some(a=>a.membershipId===w.id));
 const root='/workspace/'+organizationId;
 function show(id:string|null){setStatus('');setRename('');setWorker('');setSearch(id?{site:id}:{},{replace:true})}
 async function send(action:string,body:object){
  if(pending.current||!value)return;
  pending.current=true;setBusy(true);setStatus('');
  try{
   const result=await factoryCall(action,body) as {worksiteId?:string;name?:string};
   if(action==='create-site'){
    if(!result.worksiteId)throw Error();
    setNewSite({id:result.worksiteId,name:name.trim()});setCreateOpen(false);show(result.worksiteId);op.current=crypto.randomUUID();setName('');
   }
   if(action==='assign-internal')setWorker('');
   if(action==='rename-site'&&result.worksiteId&&result.name){
    setValue(v=>v&&({...v,worksites:v.worksites.map(w=>w.id===result.worksiteId?{...w,name:result.name!}:w)}));
    setRename('');
   }
   setStatus(action==='create-site'?'siteCreated':action==='rename-site'?'renamed':action==='assign-internal'||action==='revoke-assignment'?'assignmentChanged':'connectionChanged');
  }catch{setStatus('saveError')}
  finally{setAttempt(n=>n+1);pending.current=false;setBusy(false)}
 }
 const notice=status&&<p role={status==='saveError'?'alert':'status'}>{status==='renamed'?copy.renamed:tx(status)}</p>;
 return <section className="dashboard-panel worker-enrollment agency-site-panel" aria-busy={busy||enabled&&!value&&!loadError}>
  <div className="form-actions">
   <button type="button" className={'button '+(tab==='internal'?'button--primary':'button--outline')} aria-pressed={tab==='internal'} onClick={()=>{setStatus('');setTab('internal')}}>{tx('internalList')}</button>
   <button type="button" className={'button '+(tab==='connections'?'button--primary':'button--outline')} aria-pressed={tab==='connections'} onClick={()=>{setStatus('');setTab('connections')}}>{ft('connections')}</button>
  </div>
  {!enabled&&<p className="notice-box" role="status">{tx('notEnabled')}</p>}
  {enabled&&!value&&!loadError&&<p role="status">{t('workspaceRead.checking')}</p>}
  {loadError&&<p role="alert">{tx('loadError')} <button type="button" className="button button--outline" onClick={()=>setAttempt(n=>n+1)}>{copy.retry}</button></p>}
  <div key={tab} className="agency-production-leaf">
  {tab==='internal'?<>
   <p>{tx('internalHint')}</p>
   <button type="button" className="button button--outline" disabled={!value||busy} onClick={()=>{setStatus('');setCreateOpen(true)}}>{tx('create')}</button>
   {sites.length?<ul className="agency-site-list">{sites.map(w=><li key={w.id}><button type="button" className="button button--outline" onClick={()=>show(w.id)}>{w.name}<span>{copy.open}</span></button></li>)}</ul>:<p>{ft('noSites')}</p>}
  </>:<>
   <p>{tx('connectionHint')}</p>
   {value&&(connections.length?<ul className="agency-site-list">{connections.map(c=><li key={c.id}><button type="button" className="button button--outline" onClick={()=>{setStatus('');setConnection(c)}}>{c.factoryName} · {c.worksiteName}<span>{ft(c.state)}</span></button></li>)}</ul>:<p>{tx('noConnections')}</p>)}
   {value&&factoryInvites&&<FactoryIndependencePanel organizationId={organizationId} agencyOnly/>}
  </>}
  </div>
  {!createOpen&&!site&&!connection&&notice}
  {createOpen&&<AgencyBookDrawer title={tx('create')} closeLabel={t('common.close')} busy={busy} onClose={()=>{setCreateOpen(false);setStatus('')}}>
   <form className="auth-form" onSubmit={e=>{e.preventDefault();if(name.trim())void send('create-site',{organizationId,name:name.trim(),operationId:op.current})}}>
    <label className="field-label">{ft('siteName')}<input required maxLength={120} value={name} disabled={busy} onChange={e=>{op.current=crypto.randomUUID();setName(e.currentTarget.value)}}/></label>
    <button className="button button--primary" disabled={busy||!name.trim()}>{tx('create')}</button>
   </form>{notice}
  </AgencyBookDrawer>}
  {site&&!createOpen&&<AgencyBookDrawer key={site.id} title={site.name} closeLabel={t('common.close')} busy={busy} onClose={()=>show(null)}>
   <p>{ft('internal')}</p>
   <details className="notice-box"><summary>{copy.settings}</summary>
    <form className="auth-form" onSubmit={e=>{e.preventDefault();if(rename.trim())void send('rename-site',{worksiteId:site.id,name:rename.trim()})}}>
     <label className="field-label">{ft('siteName')}<input value={rename} placeholder={site.name} required maxLength={120} onChange={e=>setRename(e.target.value)} disabled={busy}/></label>
     <button className="button button--primary" disabled={busy||!rename.trim()}>{copy.saveName}</button>
    </form>
   </details>
   <h3>{copy.team}</h3>
   {!here.length&&<p>{copy.empty}</p>}
   {here.length>0&&<ul className="hosted-site-list">{here.map(a=><li key={a.worksiteId+a.membershipId} className="notice-box">
    <strong>{label(a.membershipId)}</strong>
    <p>{ft('starts')}: {new Date(a.startsAt).toLocaleString(i18n.resolvedLanguage)}</p>
    {a.endsAt&&<p>{copy.ends}: {new Date(a.endsAt).toLocaleString(i18n.resolvedLanguage)}</p>}
   </li>)}</ul>}
   {value&&available.length>0?<form className="auth-form notice-box" onSubmit={e=>{e.preventDefault();if(worker&&starts)void send('assign-internal',{worksiteId:site.id,membershipId:worker,startsAt:starts+'T00:00:00.000Z'})}}>
    <label className="field-label">{ft('worker')}<select required value={worker} onChange={e=>setWorker(e.target.value)}><option value="">{ft('select')}</option>{available.map(w=><option key={w.id} value={w.id}>{label(w.id)}</option>)}</select></label>
    <label className="field-label">{ft('starts')}<input required type="date" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
    <button className="button button--primary" disabled={busy||!worker||!starts}>{copy.addAssigned}</button>
   </form>:null}
   <Link className="button button--outline" to={root+'/workers?site='+site.id}>{copy.openWorkers}</Link>{notice}
  </AgencyBookDrawer>}
  {connection&&<AgencyBookDrawer title={connection.factoryName+' · '+connection.worksiteName} closeLabel={t('common.close')} busy={busy} onClose={()=>{setConnection(undefined);setStatus('')}}>
   {(()=>{const c=connections.find(v=>v.id===connection.id)??connection;return <>
    <p>{ft(c.state)}</p>
    {c.state==='pending'&&<div className="form-actions">
     <button className="button button--primary" disabled={busy} onClick={()=>void send('approve-connection',{id:c.id,confirmed:true})}>{ft('approve')}</button>
     <button className="button button--outline" disabled={busy} onClick={()=>void send('decline-connection',{id:c.id})}>{ft('decline')}</button>
    </div>}
    {c.state==='active'&&<>
     {placementsEnabled&&<FactoryTimecardsPanel organizationId={organizationId} placementOnly placementSiteId={c.worksiteId}/>}
     <details><summary>{copy.settings}</summary><button className="button button--outline" disabled={busy} onClick={()=>void send('revoke-connection',{id:c.id})}>{ft('revokeConnection')}</button></details>
    </>}
   </>})()}{notice}
  </AgencyBookDrawer>}
 </section>;
}
