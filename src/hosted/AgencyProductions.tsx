import {useEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import {factoryCall,parseSetupContext,type SetupContext,type SetupConnection,type SetupSite} from "./factory-enrollment";

export function AgencyProductions({organizationId,initialSites,enabled}:{organizationId:string;initialSites:{id:string;name:string}[];enabled:boolean}){
 const {t}=useTranslation(),tx=(key:string)=>t("agencyProductions."+key),ft=(key:string)=>t("factoryEnrollment."+key);
 const [tab,setTab]=useState<"internal"|"connections">("internal"),[value,setValue]=useState<SetupContext>();
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[attempt,setAttempt]=useState(0);
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
   setStatus(action==="create-site"?"siteCreated":"connectionChanged");setAttempt(n=>n+1);
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
  </>:<>
   <p>{tx("connectionHint")}</p>
   {value&&(connections.length?connections.map(connection):<p>{tx("noConnections")}</p>)}
  </>}
  </div>
  {status&&<p role={status.endsWith("Error")?"alert":"status"}>{tx(status)}</p>}
 </section>;
}
