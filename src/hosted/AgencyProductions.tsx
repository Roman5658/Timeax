import {useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Settings2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {AgencyFactoryConnect} from './AgencyFactoryConnect';
import {FactoryIndependencePanel} from './FactoryIndependencePanel';
import {FactoryTimecardsPanel} from './FactoryTimecardsPage';
import {useMemberNames} from './MemberNames';
import {factoryCall,parseSetupContext,type SetupContext,type SetupConnection} from './factory-enrollment';
import {getProductionCopy} from './agency-production-copy';
import {AgencyProductionSettings} from './AgencyProductionSettings';
import {zonedDateTime} from '../modules/workflows/domain/zoned-time';

const timeZone='Europe/Warsaw';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function AgencyProductions({organizationId,initialSites,enabled,factoryInvites=false,namesEnabled=false,placementsEnabled=false,settingsEnabled=false}:{organizationId:string;initialSites:{id:string;name:string}[];enabled:boolean;factoryInvites?:boolean;namesEnabled?:boolean;placementsEnabled?:boolean;settingsEnabled?:boolean}){
 const {t,i18n}=useTranslation(),tx=(key:string)=>t('agencyProductions.'+key),ft=(key:string)=>t('factoryEnrollment.'+key);
 const copy=getProductionCopy(i18n.resolvedLanguage);
 const [search,setSearch]=useSearchParams();
 const [value,setValue]=useState<SetupContext>();
 const [issued,setIssued]=useState(0);
 const [name,setName]=useState(''),[rename,setRename]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[loadError,setLoadError]=useState(false),[attempt,setAttempt]=useState(0);
 const [createOpen,setCreateOpen]=useState(false),[selectedConnection,setConnection]=useState<SetupConnection>();
 const [settings,setSettings]=useState(false),[settingsBusy,setSettingsBusy]=useState(false),[confirmDisconnect,setConfirmDisconnect]=useState(false);
 const [selectedWorkers,setSelectedWorkers]=useState<string[]>([]),[starts,setStarts]=useState(today);
 const [assignmentResult,setAssignmentResult]=useState<{saved:number;failed:number}>();
 const [newSite,setNewSite]=useState<{id:string;name:string}>();
 const {label}=useMemberNames(namesEnabled?organizationId:undefined);
 const op=useRef(crypto.randomUUID()),pending=useRef(false);
 useEffect(()=>{
  if(!enabled)return;
  const request=new AbortController();setLoadError(false);
  void factoryCall('context',undefined,request.signal).then(parseSetupContext).then(c=>{
   if(!c.memberships.some(m=>m.organizationId===organizationId&&m.role==='agency_admin'))throw Error('denied');
   if(!request.signal.aborted){setValue(c);setNewSite(v=>c.worksites.some(w=>w.id===v?.id)?undefined:v)}
  }).catch(()=>{if(!request.signal.aborted)setLoadError(true)});
  return()=>request.abort();
 },[enabled,organizationId,attempt]);
 const sites=value?value.worksites.filter(w=>w.ownerId===organizationId&&w.organizationId===organizationId):enabled?[]:initialSites;
 const siteId=search.get('site');
 const site=sites.find(w=>w.id===siteId)??(newSite?.id===siteId?newSite:undefined);
 const connections=value?.connections.filter(c=>c.agencyId===organizationId)??[];
 const connection=selectedConnection??(!site?connections.find(c=>c.worksiteId===siteId&&c.state==='active'):undefined);
 const activeConnections=connections.filter(c=>c.state==='active');
 const otherConnections=connections.filter(c=>c.state!=='active');

 const current=new Date();
 const assignments=value?.assignments.filter(a=>a.organizationId===organizationId&&a.state==='active'&&(!a.endsAt||Date.parse(a.endsAt)>current.getTime()))??[];
 const here=assignments.filter(a=>a.worksiteId===siteId);
 const workers=value?.workers.filter(w=>w.organizationId===organizationId)??[];
 const available=workers.filter(w=>!here.some(a=>a.membershipId===w.id)).sort((a,b)=>label(a.id).localeCompare(label(b.id),i18n.resolvedLanguage));
 const startInstant=zonedDateTime(starts,'00:00',timeZone);
 const root='/workspace/'+organizationId;
 function show(id:string|null,edit=false){setSettings(edit);setConnection(undefined);setStatus('');setRename('');setSelectedWorkers([]);setStarts(today());setAssignmentResult(undefined);setSearch(id?{site:id}:{},{replace:true})}
 function showConnection(c:SetupConnection|undefined,edit=false){
  setSettings(edit);setConnection(c);setConfirmDisconnect(false);setStatus('');setSearch({},{replace:true});
 }
 function saveSiteName(id:string,updatedName:string){
  setValue(v=>v&&({...v,worksites:v.worksites.map(w=>w.id===id?{...w,name:updatedName}:w)}));
  setNewSite(v=>v?.id===id?{id,name:updatedName}:v);
 }

 async function send(action:string,body:object){
  if(pending.current||!value)return;
  pending.current=true;setBusy(true);setStatus('');
  try{
   const result=await factoryCall(action,body) as {worksiteId?:string;name?:string};
   if(action==='create-site'){
    if(!result.worksiteId)throw Error();
    setNewSite({id:result.worksiteId,name:name.trim()});setCreateOpen(false);show(result.worksiteId);op.current=crypto.randomUUID();setName('');
   }
   if(action==='revoke-connection')setConfirmDisconnect(false);
   if(action==='rename-site'&&result.worksiteId&&result.name){
    setValue(v=>v&&({...v,worksites:v.worksites.map(w=>w.id===result.worksiteId?{...w,name:result.name!}:w)}));
    setRename('');
   }
   setStatus(action==='create-site'?'siteCreated':action==='rename-site'?'renamed':'connectionChanged');
  }catch{setStatus('saveError')}
  finally{setAttempt(n=>n+1);pending.current=false;setBusy(false)}
 }
 async function assignSelected(worksiteId:string){
  if(pending.current||!value||site?.id!==worksiteId||!Number.isFinite(startInstant.getTime()))return;
  const ids=available.map(w=>w.id).filter(id=>selectedWorkers.includes(id));
  if(!ids.length)return;
  pending.current=true;setBusy(true);setStatus('');setAssignmentResult(undefined);
  const startsAt=startInstant.toISOString(),added:SetupContext['assignments']=[],failed:string[]=[];
  try{
   for(const membershipId of ids){
    try{
     const result=await factoryCall('assign-internal',{worksiteId,membershipId,startsAt}) as {worksiteId?:string;membershipId?:string;startsAt?:string};
     if(result.worksiteId!==worksiteId||result.membershipId!==membershipId||Date.parse(result.startsAt??'')!==startInstant.getTime())throw Error('assignment unavailable');
     added.push({worksiteId,membershipId,organizationId,startsAt,state:'active',role:'worker'});
    }catch{failed.push(membershipId)}
   }
   if(added.length)setValue(v=>v&&({...v,assignments:[...v.assignments.filter(a=>a.worksiteId!==worksiteId||!added.some(s=>s.membershipId===a.membershipId)),...added]}));
   setSelectedWorkers(failed);setAssignmentResult({saved:added.length,failed:failed.length});
  }finally{setAttempt(n=>n+1);pending.current=false;setBusy(false)}
 }
 const connectionList=(items:SetupConnection[])=><ul className="agency-site-list">{items.map(c=><li key={c.id}>
  <button type="button" className="button button--outline agency-site-open" onClick={()=>showConnection(c)}>{c.factoryName} &middot; {c.worksiteName}<span>{ft(c.state)}</span></button>
  {c.state==='active'&&<button type="button" className="button button--outline agency-site-settings" aria-label={copy.settings+': '+c.worksiteName} onClick={()=>showConnection(c,true)}><Settings2 size={16} aria-hidden="true"/>{copy.settings}</button>}
 </li>)}</ul>;
 const notice=status&&<p role={status==='saveError'?'alert':'status'}>{status==='renamed'?copy.renamed:tx(status)}</p>;
 return <section className="dashboard-panel worker-enrollment agency-site-panel" aria-busy={busy||enabled&&!value&&!loadError}>
  <h2>{tx('internalList')}</h2>
  <div className="form-actions agency-production-actions">
   <button type="button" className="button button--primary" disabled={!value||busy} onClick={()=>{setStatus('');setCreateOpen(true)}}>{tx('create')}</button>
   {factoryInvites&&<AgencyFactoryConnect organizationId={organizationId} disabled={!value||busy} onIssued={()=>setIssued(n=>n+1)}/>}
  </div>
  {!enabled&&<p className="notice-box" role="status">{tx('notEnabled')}</p>}
  {enabled&&!value&&!loadError&&<p role="status">{t('workspaceRead.checking')}</p>}
  {loadError&&<p role="alert">{tx('loadError')} <button type="button" className="button button--outline" onClick={()=>setAttempt(n=>n+1)}>{copy.retry}</button></p>}
  <div className="agency-production-leaf">
   {sites.length>0&&<h3>{copy.internalSites}</h3>}
   {sites.length?<ul className="agency-site-list">{sites.map(w=><li key={w.id}><button type="button" className="button button--outline agency-site-open" onClick={()=>show(w.id)}>{w.name}<span>{copy.open}</span></button>
   {value&&<button type="button" className="button button--outline agency-site-settings" aria-label={copy.settings+': '+w.name} onClick={()=>show(w.id,true)}><Settings2 size={16} aria-hidden="true"/>{copy.settings}</button>}</li>)}</ul>:value&&!activeConnections.length?<p>{copy.noSites}</p>:null}
   {activeConnections.length>0&&<><h3>{copy.connectedSites}</h3>{connectionList(activeConnections)}</>}
   {otherConnections.length>0&&<><h3>{copy.connectionRequests}</h3>{connectionList(otherConnections)}</>}
   {value&&factoryInvites&&<FactoryIndependencePanel organizationId={organizationId} revision={issued} agencyOnly/>}
  </div>
  {!createOpen&&!site&&!connection&&notice}
  {createOpen&&<AgencyBookDrawer title={tx('create')} closeLabel={t('common.close')} centered busy={busy} onClose={()=>{setCreateOpen(false);setStatus('')}}>
   <form className="auth-form" onSubmit={e=>{e.preventDefault();if(name.trim())void send('create-site',{organizationId,name:name.trim(),operationId:op.current})}}>
    <label className="field-label">{ft('siteName')}<input required maxLength={120} value={name} disabled={busy} onChange={e=>{op.current=crypto.randomUUID();setName(e.currentTarget.value)}}/></label>
    <button className="button button--primary" disabled={busy||!name.trim()}>{tx('create')}</button>
   </form>{notice}
  </AgencyBookDrawer>}
  {site&&!createOpen&&<AgencyBookDrawer key={site.id} title={site.name} closeLabel={t('common.close')} centered busy={busy||settingsBusy} onClose={()=>show(null)}>
   <p>{ft('internal')}</p>
   {value&&<div className="form-actions"><button className="button button--outline" type="button" aria-pressed={settings} disabled={busy||settingsBusy} onClick={()=>{setSettings(v=>!v);setStatus('')}}><Settings2 size={16} aria-hidden="true"/>{copy.settings}</button></div>}
   {value&&settingsEnabled&&<AgencyProductionSettings organizationId={organizationId} worksiteId={site.id} connected={false} form={settings} suspended={busy} onBusy={setSettingsBusy} onSaved={name=>saveSiteName(site.id,name)}/>}
   {value&&settings&&!settingsEnabled&&<form className="auth-form notice-box" onSubmit={e=>{e.preventDefault();if(rename.trim())void send('rename-site',{worksiteId:site.id,name:rename.trim()})}}>
    <label className="field-label">{ft('siteName')}<input value={rename} placeholder={site.name} required maxLength={120} onChange={e=>setRename(e.target.value)} disabled={busy}/></label>
    <button className="button button--primary" disabled={busy||!rename.trim()}>{copy.saveName}</button>
   </form>}
   {!settings&&<>
   <h3>{copy.team}</h3>
   {!here.length&&<p>{copy.empty}</p>}
   {here.length>0&&<ul className="hosted-site-list">{here.map(a=><li key={a.worksiteId+a.membershipId} className="notice-box">
    <strong>{label(a.membershipId)}</strong>
    <p>{copy.starts}: {new Date(a.startsAt).toLocaleDateString(i18n.resolvedLanguage,{timeZone})}</p>
    {a.endsAt&&<p>{copy.ends}: {new Date(a.endsAt).toLocaleDateString(i18n.resolvedLanguage,{timeZone})}</p>}
   </li>)}</ul>}
   {value&&(available.length>0?<form className="auth-form notice-box" onSubmit={e=>{e.preventDefault();void assignSelected(site.id)}}>
    <fieldset className="agency-production-workers" disabled={busy}>
     <legend>{copy.chooseWorkers}</legend><p>{copy.assignmentHint}</p>
     <div className="agency-production-worker-list">{available.map(w=><label className="timecards-check" key={w.id}>
      <input type="checkbox" checked={selectedWorkers.includes(w.id)} onChange={e=>{const checked=e.currentTarget.checked;setSelectedWorkers(ids=>checked?[...ids,w.id]:ids.filter(id=>id!==w.id))}}/>{label(w.id)}
     </label>)}</div>
     <label className="field-label">{copy.starts}<input required type="date" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
    </fieldset>
    <button className="button button--primary" disabled={busy||!available.some(w=>selectedWorkers.includes(w.id))||!Number.isFinite(startInstant.getTime())}>{copy.addAssigned}</button>
   </form>:!workers.length?<p>{tx('noWorkers')}</p>:null)}
   {assignmentResult&&<p role={assignmentResult.failed?'alert':'status'}>{copy.assignedCount}: {assignmentResult.saved}{assignmentResult.failed>0&&<>. {copy.failedCount}: {assignmentResult.failed}. {copy.assignmentRetry}</>}</p>}
   <Link className="button button--outline" to={root+'/workers?site='+site.id}>{copy.openWorkers}</Link></>}{notice}
  </AgencyBookDrawer>}
  {connection&&<AgencyBookDrawer key={connection.id} title={connection.factoryName+' '+connection.worksiteName} closeLabel={t('common.close')} centered busy={busy||settingsBusy} onClose={()=>showConnection(undefined)}>
   {(()=>{const c=connections.find(v=>v.id===connection.id)??connection;return <>
    <p>{ft(c.state)}</p>
    {c.state==='pending'&&<div className="form-actions">
     <button className="button button--primary" disabled={busy} onClick={()=>void send('approve-connection',{id:c.id,confirmed:true})}>{ft('approve')}</button>
     <button className="button button--outline" disabled={busy} onClick={()=>void send('decline-connection',{id:c.id})}>{ft('decline')}</button>
    </div>}
    {c.state==='active'&&<>
     <div className="form-actions"><button className="button button--outline" type="button" aria-pressed={settings} disabled={busy||settingsBusy} onClick={()=>{setSettings(v=>!v);setConfirmDisconnect(false);setStatus('')}}><Settings2 size={16} aria-hidden="true"/>{copy.settings}</button></div>
     {settingsEnabled&&<AgencyProductionSettings organizationId={organizationId} worksiteId={c.worksiteId} connected form={settings} suspended={busy||confirmDisconnect} onBusy={setSettingsBusy} onSaved={()=>{}}/>}
     {!settings&&placementsEnabled&&<FactoryTimecardsPanel organizationId={organizationId} placementOnly placementSiteId={c.worksiteId}/>}
     {settings&&<section className="notice-box">
      {!confirmDisconnect?<button type="button" className="button button--outline" disabled={busy||settingsBusy} onClick={()=>setConfirmDisconnect(true)}>{ft('revokeConnection')}</button>
       :<><p>{copy.disconnectHint}</p><div className="form-actions">
        <button type="button" className="button button--outline" disabled={busy} onClick={()=>void send('revoke-connection',{id:c.id})}>{ft('revokeConnection')}</button>
        <button type="button" className="button button--outline" disabled={busy} onClick={()=>setConfirmDisconnect(false)}>{t('common.cancel')}</button>
       </div></>}
     </section>}
    </>}
   </>})()}{notice}
  </AgencyBookDrawer>}
 </section>;
}
