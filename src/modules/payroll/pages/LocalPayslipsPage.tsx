import {AccountantAccess,AccountantLoginPanel} from "./AccountantAccess";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {TopBar} from "../../../components/TopBar";
import {StagingSessionPanel} from "../../auth/pages/StagingSessionPanel";
import {createPayslipClient,PayslipError,type PayContext,type PayDraft,type PayValues,type Publication} from "../payslip-client";
import {calculatePayroll} from "../domain/payroll";
import {payslipHtml} from "../payslip-document";
import "../../../styles/membership-hours.css";
type Action=(route:string,input:object)=>Promise<boolean>;
function Draft({draft,ctx,act,busy}:{draft:PayDraft;ctx:PayContext;act:Action;busy:boolean}){
 const {t}=useTranslation(),px=(k:string)=>t("localPayslip."+k),d=draft;
 const [v,setV]=useState({nightMinutes:String(d.calculation?.nightMinutes??0),dayRate:String(d.calculation?.dayRate??""),nightRate:String(d.calculation?.nightRate??""),additions:String(d.calculation?.additions??0),deductions:String(d.calculation?.deductions??0),note:d.calculation?.note??""});
 const [confirmed,setConfirmed]=useState(false),[assignee,setAssignee]=useState(d.assignee_id??"");
 const editable=!d.owner||d.assignee_id===null;
 const values:PayValues={nightMinutes:Number(v.nightMinutes),dayRate:v.dayRate===""?NaN:Number(v.dayRate),nightRate:v.nightRate===""?NaN:Number(v.nightRate),additions:Number(v.additions),deductions:Number(v.deductions),note:v.note};
 const estimate=calculatePayroll({dayHours:(d.source.paidMinutes-values.nightMinutes)/60,nightHours:values.nightMinutes/60,dayRate:values.dayRate,nightRate:values.nightRate,additions:values.additions,deductions:values.deductions,note:values.note});
 const dirty=d.calculation?Object.entries(values).some(([k,value])=>value!==d.calculation![k as keyof PayValues]):true;
 return <article className="membership-card" data-testid="pay-draft" data-record-id={d.id}>
  <h3>{d.source.workerName} · {d.source.siteName}</h3><p>{d.source.dateFrom} — {d.source.dateTo} · {px(d.source.kind)}</p>
  <p>{px("calculationState")}: <strong>{px(d.state)}</strong> · {px("deliveryState")}: {px("unpublished")}</p>
  <p>{px("sourceMinutes")}: {d.source.paidMinutes} · {px("sourceId")}: {d.source.sourceId}</p>
  {d.owner&&<div className="membership-grid"><label className="field-label"><span>{px("processor")}</span><select data-testid="pay-assignee" value={assignee} onChange={e=>setAssignee(e.target.value)} disabled={busy}><option value="">{px("agencySelf")}</option>{ctx.accountants.filter(a=>a.kind===d.kind&&a.agencyId===d.agency_id).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button type="button" className="button button--outline" disabled={busy||assignee===(d.assignee_id??"")} onClick={()=>void act("/assign",{id:d.id,revision:d.revision,accountantId:assignee||null})}>{px("assign")}</button></div>}
  {!editable&&<p>{px("delegated")}</p>}
  <form className="membership-grid" onSubmit={e=>{e.preventDefault();void act("/save",{id:d.id,revision:d.revision,values})}}>
   <label className="field-label"><span>{t("payroll.dayHours")}</span><output>{((d.source.paidMinutes-values.nightMinutes)/60).toFixed(2)}</output></label>
   <label className="field-label"><span>{px("nightMinutes")}</span><input data-field="nightMinutes" type="number" min="0" max={d.source.paidMinutes} step="1" value={v.nightMinutes} disabled={busy||!editable} onChange={e=>{setV({...v,nightMinutes:e.target.value});setConfirmed(false)}} required /></label>
   {(["dayRate","nightRate","additions","deductions"] as const).map(k=><label className="field-label" key={k}><span>{t("payroll."+k)}</span><input data-field={k} type="number" min="0" max={k.endsWith("Rate")?10000:10000000} step="0.01" value={v[k]} disabled={busy||!editable} onChange={e=>{setV({...v,[k]:e.target.value});setConfirmed(false)}} required /></label>)}
   <label className="field-label membership-wide"><span>{px("calculationNote")}</span><textarea data-field="note" minLength={2} maxLength={500} value={v.note} disabled={busy||!editable} onChange={e=>{setV({...v,note:e.target.value});setConfirmed(false)}} required /></label>
   <p className="membership-wide">{px("manual")} {estimate?t("payroll.gross")+": "+estimate.gross.toFixed(2)+" PLN · "+t("payroll.net")+": "+estimate.net.toFixed(2)+" PLN":px("invalid")}</p>
   <button type="submit" className="button button--primary" disabled={busy||!editable||!estimate||!Number.isInteger(values.nightMinutes)||!v.note.trim()}>{px("save")}</button>
  </form>
  {editable&&d.calculation&&<div className="membership-record">
   <p data-testid="pay-saved-totals">{px("saved")} {t("payroll.gross")}: {(d.calculation.grossCents/100).toFixed(2)} PLN / {t("payroll.net")}: {(d.calculation.netCents/100).toFixed(2)} PLN</p>
   {d.state==="draft"&&<><label className="checkbox-field"><input data-testid="pay-confirm" type="checkbox" checked={confirmed} disabled={busy||dirty} onChange={e=>setConfirmed(e.target.checked)} /><span>{px("finalCheckText")}</span></label><button className="button button--outline" disabled={busy||dirty||!confirmed} onClick={()=>void act("/check",{id:d.id,revision:d.revision,confirmed:true})}>{px("check")}</button></>}
   <button className="button button--primary" disabled={busy||dirty||d.state!=="checked"} onClick={()=>void act("/publish",{id:d.id,revision:d.revision})}>{px("publish")}</button>
   <p>{px("noSecondApproval")}</p>
  </div>}
 </article>;
}
export function LocalPayslipsPage({section}:{section:"agency"|"accountant"|"worker"}){
 const {t}=useTranslation(),px=(k:string)=>t("localPayslip."+k);
 const api=useMemo(()=>createPayslipClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [ctx,setCtx]=useState<PayContext>(),[busy,setBusy]=useState(true),[notice,setNotice]=useState("checking"),[reload,setReload]=useState(0);
 const [selected,setSelected]=useState(""),[requestId,setRequestId]=useState(""),[scope,setScope]=useState(""),[month,setMonth]=useState(""),[note,setNote]=useState("");
 const pending=useRef<AbortController|null>(null),mounted=useRef(false);
 const allowed=useCallback((v:PayContext)=>section==="agency"?v.scopes.length>0:section==="accountant"?v.accountant:v.workerScopes.length>0||v.published.length>0,[section]);
 const refresh=useCallback(()=>{pending.current?.abort();pending.current=null;setCtx(undefined);setBusy(true);setNotice("checking");setSelected("");setRequestId("");setReload(x=>x+1)},[]);
 useEffect(()=>{mounted.current=true;const c=new AbortController();pending.current=c;
  void (async()=>{try{if(!api)throw new PayslipError(403,"closed");const data=await api.context(c.signal);if(!allowed(data))throw new PayslipError(403,"closed");
   if(!c.signal.aborted){setCtx(data);setNotice("ready")}}catch(e){if(!c.signal.aborted){setCtx(undefined);setNotice(e instanceof PayslipError?e.message:"unavailable")}}
   finally{if(pending.current===c)pending.current=null;if(!c.signal.aborted)setBusy(false)}})();
  return()=>{mounted.current=false;c.abort();pending.current?.abort();pending.current=null};
 },[api,allowed,reload]);
 useEffect(()=>{
  if(section!=="accountant"||!ctx||!api)return;
  const c=new AbortController();
  const check=async()=>{try{const next=await api.context(c.signal);if(!next.accountant&&!c.signal.aborted){pending.current?.abort();pending.current=null;setCtx(undefined);setBusy(false);setNotice("closed")}}
   catch{if(!c.signal.aborted){pending.current?.abort();pending.current=null;setCtx(undefined);setBusy(false);setNotice("closed")}}};
  const timer=setInterval(()=>void check(),10000);window.addEventListener("focus",check);
  return()=>{c.abort();clearInterval(timer);window.removeEventListener("focus",check)};
 },[section,ctx,api]);
 const act:Action=async(route,input)=>{if(!api||!ctx||pending.current)return false;const c=new AbortController();pending.current=c;setBusy(true);
  try{await api.request(route,c.signal,input,ctx.csrf);const data=await api.context(c.signal);if(!allowed(data))throw new PayslipError(403,"closed");
   if(mounted.current&&!c.signal.aborted){setCtx(data);setNotice("saved");return true}}
  catch(e){if(mounted.current&&!c.signal.aborted){setNotice(e instanceof PayslipError?e.message:"uncertain");if(e instanceof PayslipError&&e.status===403)setCtx(undefined)}}
  finally{if(pending.current===c)pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}return false};
 async function download(p:Publication){
  if(!api||pending.current)return;const c=new AbortController();pending.current=c;setBusy(true);
  try{const fresh=await api.request<Publication>("/documents/"+p.id,c.signal);if(c.signal.aborted||!mounted.current)return;
   const url=URL.createObjectURL(new Blob([payslipHtml(fresh)],{type:"text/html;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="timeax-payslip-"+p.id+"-v1.html";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(!c.signal.aborted&&mounted.current){setNotice(e instanceof PayslipError?e.message:"unavailable");if(e instanceof PayslipError&&e.status===403)setCtx(undefined)}}
  finally{if(pending.current===c)pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}
 }
 const source=ctx?.sources.find(s=>s.kind+":"+s.sourceId+":"+s.workerKey===selected);
 const workerScope=ctx?.workerScopes.find(s=>s.kind+":"+s.agencyId===scope);
 return <><TopBar/><main className="membership-main">
  <section className="membership-card"><h1>{px(section==="worker"?"workerTitle":"title")}</h1><p className="notice-box">{px("local")}</p>
   <nav className="factory-links">{section==="agency"?<><Link to="/agency/workers#timesheets">{t("agencyArchive.internal")}</Link>{" / "}<Link to="/agency/monthly-timesheets">{t("agencyArchive.factory")}</Link></>:section==="worker"?<Link to="/worker/shifts">{t("localWorkspace.workerTitle")}</Link>:null}</nav>
   {section==="accountant"?<AccountantLoginPanel onChanged={refresh}/>:<StagingSessionPanel purpose="existing" audience="workspace" onChanged={refresh}/>}<p role="status" data-testid="pay-status">{px(busy?"checking":notice)}</p><button className="button button--outline" disabled={busy} onClick={refresh}>{px("refresh")}</button>
  </section>
  {ctx&&<>
   {section==="agency"&&<AccountantAccess ctx={ctx} onChanged={refresh}/>}
   <section className="membership-card"><p>{px("rights")}</p><p>{px("notifications")}</p><p>{px("disclaimer")}</p></section>
   {section==="agency"&&<section className="membership-card"><h2>{px("createTitle")}</h2><p>{px("sourceHint")}</p><form className="membership-grid" onSubmit={e=>{e.preventDefault();if(source)void act("/create",{kind:source.kind,sourceId:source.sourceId,workerKey:source.workerKey,requestId:requestId||null})}}>
    <label className="field-label membership-wide"><span>{px("source")}</span><select id="pay-source" value={selected} onChange={e=>{setSelected(e.target.value);setRequestId("")}} required disabled={busy}><option value="">{px("choose")}</option>{ctx.sources.map(s=><option key={s.kind+":"+s.sourceId+":"+s.workerKey} value={s.kind+":"+s.sourceId+":"+s.workerKey}>{s.workerName} · {s.siteName} · {s.dateFrom} — {s.dateTo} · {px(s.kind)}</option>)}</select></label>
    <label className="field-label"><span>{px("linkRequest")}</span><select id="pay-request" value={requestId} disabled={busy} onChange={e=>setRequestId(e.target.value)}><option value="">{px("noRequest")}</option>{ctx.requests.filter(r=>r.state==="requested").map(r=><option key={r.id} value={r.id}>{r.month} · {r.note}</option>)}</select></label>
    <button type="submit" className="button button--primary" disabled={busy||!source}>{px("create")}</button></form></section>}
   {section!=="worker"&&<section aria-label={px("drafts")} style={{display:"grid",gap:20}}><h2>{px("drafts")}</h2>{!ctx.drafts.length&&<p>{px("noDrafts")}</p>}{ctx.drafts.map(d=><Draft key={d.id+":"+d.revision} draft={d} ctx={ctx} act={act} busy={busy}/>)}</section>}
   {section==="worker"&&<section className="membership-card"><h2>{px("requestTitle")}</h2><p>{px("requestHint")}</p><form className="membership-grid" onSubmit={e=>{e.preventDefault();if(workerScope)void act("/request",{kind:workerScope.kind,agencyId:workerScope.agencyId,month:month+"-01",note})}}>
    <label className="field-label"><span>{px("agency")}</span><select id="pay-scope" value={scope} disabled={busy} onChange={e=>setScope(e.target.value)} required><option value="">{px("choose")}</option>{ctx.workerScopes.map(s=><option key={s.kind+s.agencyId} value={s.kind+":"+s.agencyId}>{s.name} · {px(s.kind)}</option>)}</select></label>
    <label className="field-label"><span>{px("month")}</span><input id="pay-month" type="month" required value={month} disabled={busy} onChange={e=>setMonth(e.target.value)}/></label>
    <label className="field-label membership-wide"><span>{px("requestNote")}</span><textarea id="pay-request-note" required minLength={2} maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><button type="submit" className="button button--outline" disabled={busy||!workerScope||!month||note.trim().length<2}>{px("request")}</button></form></section>}
   {ctx.requests.length>0&&<section className="membership-card"><h2>{px("requests")}</h2>{ctx.requests.map(r=><p key={r.id} data-testid="pay-request-record">{r.month} · {r.note} · {px(r.state)}</p>)}</section>}
   <section className="membership-card"><h2>{px("published")}</h2>{!ctx.published.length&&<p data-testid="pay-empty">{px("empty")}</p>}{ctx.published.map(p=><article className="payroll-slip" data-testid="pay-published" data-record-id={p.id} key={p.id}>
    <h3>{p.document.source.workerName} · {p.document.source.agencyName}</h3><p>{p.document.source.siteName} · {p.document.source.dateFrom} — {p.document.source.dateTo}</p><p>{px("checked")} · {px("cabinet")} · {px("noNotification")}</p>
    <dl><div><dt>{t("payroll.gross")}</dt><dd>{(p.document.calculation.grossCents/100).toFixed(2)} PLN</dd></div><div><dt>{t("payroll.deductions")}</dt><dd>{p.document.calculation.deductions.toFixed(2)} PLN</dd></div><div><dt>{t("payroll.net")}</dt><dd>{(p.document.calculation.netCents/100).toFixed(2)} PLN</dd></div></dl><p>{p.document.calculation.note}</p><p>{px("version")}: 1 · {p.issued_at}</p><button className="button button--outline" disabled={busy} onClick={()=>void download(p)}>{px("download")}</button>
   </article>)}</section>
  </>}
 </main></>;
}
