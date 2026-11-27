import {useEffect,useRef,useState} from "react";
import {FactoryIndependencePanel} from './FactoryIndependencePanel';
import {useMemberNames} from './MemberNames';
import {useTranslation} from "react-i18next";
import {factoryCall,parseSetupContext,type SetupContext,type SetupConnection,type SetupSite} from "./factory-enrollment";

export function AgencyProductions({organizationId,initialSites,enabled,factoryInvites=false,namesEnabled=false}:{organizationId:string;initialSites:{id:string;name:string}[];enabled:boolean;factoryInvites?:boolean;namesEnabled?:boolean}){
 const {t}=useTranslation(),tx=(key:string)=>t("agencyProductions."+key),ft=(key:string)=>t("factoryEnrollment."+key);
 const [tab,setTab]=useState<"internal"|"connections">("internal"),[value,setValue]=useState<SetupContext>();
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[attempt,setAttempt]=useState(0);
 const [internalSite,setInternalSite]=useState(""),[worker,setWorker]=useState(""),[starts,setStarts]=useState(new Date().toISOString().slice(0,10));
 const {label}=useMemberNames(namesEnabled?organizationId:undefined);
 const op=useRef(crypto.randomUUID()),pending=useRef(false);
 useEffect(()=>{
  if(!enabled)return;
  const request=new AbortController();
  void factoryCall("context",undefined,request.signal).then(parseSetupContext).then(c=>{
   if(!c.memberships.some(m=>m.organizationId===organizationId&&m.role==="agency_admin"))throw Error("denied");
   if(!request.signal.aborted)setValue(c);
  }).catch(()=>{if(!request.signal.aborted)setStatus("loadError")});
  return()=>request.abort();
 },[enabled,organizationId,attempt]);
 const displaySites:{id:string;name:string}[]=value?value.worksites.filter((w:SetupSite)=>w.ownerId===organizationId&&w.organizationId===organizationId):initialSites;
 const connections=value?.connections.filter(c=>c.agencyId===organizationId)??[];
 async function send(action:string,body:object){
  if(pending.current||!value)return;
  pending.current=true;setBusy(true);setStatus("");
  try{
   await factoryCall(action,body);
   if(action==="create-site"){op.current=crypto.randomUUID();setName("");}
   setStatus(action==="create-site"?"siteCreated":action==="assign-internal"||action==="revoke-assignment"?"assignmentChanged":"connectionChanged");setAttempt(n=>n+1);
  }catch{setStatus("saveError");setAttempt(n=>n+1)}
  finally{pending.current=false;setBusy(false)}
 }
 function connection(c:SetupConnection){
  return <article className="notice-box" key={c.id}>
   <h3>{c.factoryName} · {c.worksiteName}</h3><p>{ft(c.state)}</p>
   {c.state==="pending"&&<div className="form-actions">
    <button className="button button--primary" disabled={busy} onClick={()=>void send("approve-connection",{id:c.id,confirmed:true})}>{ft("approve")}</button>
    <button className="button button--outline" disabled={busy} onClick={()=>void send("decline-connection",{id:c.id})}>{ft("decline")}</button>
   </div>}
   {c.state==="active"&&<button className="button button--outline" disabled={busy} onClick={()=>void send("revoke-connection",{id:c.id})}>{ft("revokeConnection")}</button>}
  </article>;
 }
 return <section className="dashboard-panel worker-enrollment" aria-busy={busy||enabled&&!value&&!status}>
  <div className="form-actions">
   <button type="button" className={"button "+(tab==="internal"?"button--primary":"button--outline")} aria-pressed={tab==="internal"} onClick={()=>setTab("internal")}>{tx("create")}</button>
   <button type="button" className={"button "+(tab==="connections"?"button--primary":"button--outline")} aria-pressed={tab==="connections"} onClick={()=>setTab("connections")}>{tx("connect")}</button>
  </div>
  {!enabled&&<p className="notice-box" role="status">{tx("notEnabled")}</p>}
  {enabled&&!value&&!status&&<p role="status">{t("workspaceRead.checking")}</p>}
  <div key={tab} className="agency-production-leaf">
  {tab==="internal"?<>
   <p>{tx("internalHint")}</p>
   {value&&<form className="auth-form" onSubmit={e=>{e.preventDefault();if(name.trim())void send("create-site",{organizationId,name:name.trim(),operationId:op.current})}}>
    <label className="field-label">{ft("siteName")}<input required maxLength={120} value={name} disabled={busy} onChange={e=>{op.current=crypto.randomUUID();setName(e.currentTarget.value)}}/></label>
    <button className="button button--primary" disabled={busy||!name.trim()}>{tx("create")}</button>
   </form>}
   <h3>{tx("internalList")}</h3>{displaySites.length?<ul>{displaySites.map(w=><li key={w.id}>{w.name}</li>)}</ul>:<p>{ft("noSites")}</p>}
   {value&&displaySites.length>0&&<section className="notice-box">
    <h3>{ft("assignWorker")}</h3>
    {value.workers.some(w=>w.organizationId===organizationId)?<form className="auth-form" onSubmit={e=>{e.preventDefault();if(internalSite&&worker&&starts)void send("assign-internal",{worksiteId:internalSite,membershipId:worker,startsAt:starts+"T00:00:00.000Z"})}}>
      <label className="field-label">{ft("site")}<select required value={internalSite} onChange={e=>setInternalSite(e.target.value)}><option value="">{ft("select")}</option>{displaySites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="field-label">{ft("worker")}<select required value={worker} onChange={e=>setWorker(e.target.value)}><option value="">{ft("select")}</option>{value.workers.filter(w=>w.organizationId===organizationId).map(w=><option key={w.id} value={w.id}>{label(w.id)}</option>)}</select></label>
      <label className="field-label">{ft("starts")}<input required type="date" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
      <button className="button button--primary" disabled={busy||!internalSite||!worker||!starts}>{ft("assign")}</button>
    </form>:<p>{tx("noWorkers")}</p>}
    {value.assignments.filter(a=>a.organizationId===organizationId&&a.state==="active").map(a=><p key={a.worksiteId+a.membershipId}>{displaySites.find(w=>w.id===a.worksiteId)?.name}: {label(a.membershipId)} <button type="button" className="button button--outline" disabled={busy} onClick={()=>void send("revoke-assignment",{worksiteId:a.worksiteId,membershipId:a.membershipId})}>{ft("revokeAssignment")}</button></p>)}
   </section>}
  </>:<>
   <p>{tx("connectionHint")}</p>
   {value&&(connections.length?connections.map(connection):<p>{tx("noConnections")}</p>)}
   {value&&factoryInvites&&<FactoryIndependencePanel organizationId={organizationId} agencyOnly/>}
  </>}
  </div>
  {status&&<p role={status.endsWith("Error")?"alert":"status"}>{tx(status)}</p>}
 </section>;
}
