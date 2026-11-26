import {LeaderLoginPanel} from "./LeaderAccess";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {TopBar} from "../../components/TopBar";
import {StagingSessionPanel} from "../auth/pages/StagingSessionPanel";
import {createFactoryClient,FactoryError,type FactoryContext,type FactoryShift,type FactorySheet} from "./factory-client";
import {FactoryEntryForm} from "./FactoryEntryForm";
import {AgencyTimesheetNav} from "../monthly-timesheets/AgencyTimesheetNav";
import {archiveCsv,downloadArchiveCsv} from "../monthly-timesheets/domain/archive-csv";
import {duration} from "../memberships/internal-timesheet";
import "../../styles/membership-hours.css";
import "./connected-factory.css";
export function ConnectedFactoryPage({section}:{section:"leader"|"worker"|"agency"}){
 const {t}=useTranslation(),tx=(k:string)=>t("localWorkspace."+k),fx=(k:string)=>t("connectedFactory."+k);
 const api=useMemo(()=>createFactoryClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [ctx,setCtx]=useState<FactoryContext>(),[busy,setBusy]=useState(true),[notice,setNotice]=useState("checking"),[reload,setReload]=useState(0);
 const [factoryId,setFactoryId]=useState(""),[mode,setMode]=useState(""),[editing,setEditing]=useState<FactoryShift>(),[notes,setNotes]=useState<Record<string,string>>({});
 const [agency,setAgency]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("");
 const pending=useRef<AbortController|null>(null),mounted=useRef(false);
 const allowed=(data:FactoryContext)=>section==="agency"?data.agency:section==="leader"?data.factories.some(f=>f.leader):data.assignments.length>0;
 const refresh=useCallback(()=>{setBusy(true);setNotice("checking");setCtx(undefined);setEditing(undefined);setReload(x=>x+1)},[]);
 useEffect(()=>{
  mounted.current=true;const c=new AbortController();pending.current=c;setBusy(true);
  void (async()=>{try{if(!api)throw new FactoryError(403,"closed");const data=await api.context(c.signal);if(!allowed(data))throw new FactoryError(403,"closed");
    if(!c.signal.aborted){setCtx(data);setNotice("ready")}}
   catch(e){if(!c.signal.aborted){setCtx(undefined);setNotice(e instanceof FactoryError?e.message:"unavailable")}}
   finally{if(pending.current===c)pending.current=null;if(!c.signal.aborted)setBusy(false)}})();
  return()=>{mounted.current=false;c.abort();pending.current?.abort();pending.current=null};
 },[api,reload,section]);
 useEffect(()=>{
  if(section!=="leader"||!api)return;let current:AbortController|undefined;
  const check=()=>{if(pending.current)return;current?.abort();current=new AbortController();const c=current;
   void api.context(c.signal).then(data=>{if(!c.signal.aborted&&!allowed(data)){setCtx(undefined);setEditing(undefined);setNotice("closed")}})
    .catch(()=>{if(!c.signal.aborted){setCtx(undefined);setEditing(undefined);setNotice("unavailable")}});
  };
  const timer=window.setInterval(check,10000);window.addEventListener("focus",check);
  return()=>{window.clearInterval(timer);window.removeEventListener("focus",check);current?.abort()};
 },[api,section]);
 async function act(route:string,input:object){
  if(!api||!ctx||pending.current)return false;const c=new AbortController();pending.current=c;setBusy(true);
  try{await api.request(route,c.signal,input,ctx.csrf);const data=await api.context(c.signal);if(!allowed(data))throw new FactoryError(403,"closed");
   if(!c.signal.aborted&&mounted.current){setCtx(data);setNotice("saved");return true}}
  catch(e){if(mounted.current&&!c.signal.aborted){setNotice(e instanceof FactoryError?e.message:"uncertain");if(e instanceof FactoryError&&e.status===403){setCtx(undefined);setEditing(undefined)}}}
  finally{if(pending.current===c)pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}return false;
 }
 async function downloadSheet(sheet:FactorySheet){
  if(!api||pending.current)return;const c=new AbortController();pending.current=c;setBusy(true);
  try{const fresh=await api.request<FactorySheet>("/timesheets/"+sheet.id,c.signal);
   if(c.signal.aborted||!mounted.current)return;
   downloadArchiveCsv(archiveCsv({origin:t("agencyArchive.factory"),agency:fresh.snapshot.agencyName,site:fresh.snapshot.factoryName,
    from:fresh.date_from,to:fresh.date_to,id:fresh.id,createdAt:fresh.created_at,
    rows:fresh.snapshot.rows.map(r=>({id:r.id,worker:r.workerName,date:r.local_date,start:r.start_at,end:r.end_at,gross:r.gross_minutes,breaks:r.break_minutes,paid:r.paid_minutes}))}),"timeax-factory-"+fresh.id+".csv");
  }catch(e){if(mounted.current&&!c.signal.aborted){setNotice(e instanceof FactoryError?e.message:"unavailable");if(e instanceof FactoryError&&e.status===403)setCtx(undefined)}}
  finally{if(pending.current===c)pending.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}
 }
 const status=busy?"checking":notice;
 const statusText=["ready","saved","checking","closed","invalid","unavailable"].includes(status)?tx(status):fx(status);
 const factories=ctx?.factories.filter(f=>section!=="leader"||f.leader)??[],factory=factories.find(f=>f.id===factoryId)??factories[0];
 const assignments=ctx?.assignments.filter(a=>a.factory_id===factory?.id)??[],shifts=ctx?.shifts.filter(s=>s.factoryId===factory?.id)??[];
 const time=(value:string)=>new Intl.DateTimeFormat(undefined,{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
 return <div className="auth-page"><TopBar/><main className="membership-main">
  <section className="membership-card"><Link className="back-link" to="/login">{tx("signIn")}</Link><h1>{fx(section+"Title")}</h1>
   <p className="notice-box notice-box--warm">{fx("localNotice")}</p>
   <nav className="factory-links">{section==="worker"&&<Link to="/worker/factory-assignments">{t("factoryPlacement.workerTitle")}</Link>}{section==="worker"&&<Link to="/worker/shifts">{fx("internalLink")}</Link>}{section==="leader"&&<Link to="/leader/monthly-timesheets">{fx("sendPeriod")}</Link>}</nav>
   {section==="agency"&&<AgencyTimesheetNav active="factory"/>}
   {section==="leader"?<LeaderLoginPanel onChanged={refresh}/>:<StagingSessionPanel purpose="existing" audience="workspace" onChanged={refresh}/>}
   <p role="status" data-testid="factory-status" className="notice-box">{statusText}</p>
   <button className="button button--outline" type="button" disabled={busy} onClick={refresh}>{tx("refresh")}</button>
  </section>
  {ctx&&section!=="agency"&&factory&&<>
   <section className="membership-card"><label className="field-label"><span>{fx("factory")}</span><select id="connected-factory" disabled={busy} value={factory.id} onChange={e=>{setFactoryId(e.target.value);setMode("");setAgency("");setEditing(undefined)}}>{factories.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <p data-testid="factory-mode">{fx("mode")}: {fx(factory.mode)}</p>
    {section==="leader"&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act("/factories/"+factory.id+"/mode",{mode:mode||factory.mode})}}>
     <p>{fx("modeHint")}</p><label className="field-label"><span>{fx("mode")}</span><select id="factory-mode-choice" disabled={busy} value={mode||factory.mode} onChange={e=>setMode(e.target.value)}><option value="self">{fx("self")}</option><option value="attendance">{fx("attendance")}</option></select></label>
     <button type="submit" disabled={busy} className="button button--outline">{fx("saveMode")}</button>
    </form>}
   </section>
   {editing?<section className="membership-card"><h2>{fx("correct")}</h2><FactoryEntryForm key={editing.id+editing.revision} editing={editing} assignments={assignments} busy={busy} onCancel={()=>setEditing(undefined)} onSubmit={async input=>{const ok=await act("/shifts/"+editing.id+"/correct",input);if(ok)setEditing(undefined);return ok}}/></section>:
    (section==="worker"&&factory.mode==="self"||section==="leader"&&factory.mode==="attendance")&&<section className="membership-card"><h2>{fx(section==="worker"?"recordSelf":"recordAttendance")}</h2><FactoryEntryForm key={factory.id} assignments={assignments} busy={busy} onSubmit={input=>act("/shifts",input)}/></section>}
   {section==="worker"&&factory.mode==="attendance"&&<p className="membership-card">{fx("waitingLeader")}</p>}
   <section className="membership-card"><h2>{section==="leader"?fx("recordedHours"):tx("recordedHours")}</h2>{!shifts.length&&<p>{tx("empty")}</p>}
    {shifts.map(s=><article key={s.id} className="membership-record" data-testid="factory-shift" data-record-id={s.id}>
     <h3>{s.workerName} · {s.local_date}</h3><p>{s.agencyName} · {s.factoryName}</p><p>{time(s.start_at)}–{time(s.end_at)} · Europe/Warsaw</p>
     <p>{tx("gross")}: {s.gross_minutes} min · {tx("breakMinutes")}: {s.break_minutes} min · {tx("paidTime")}: {duration(s.paid_minutes)}</p>
     <p data-testid="factory-shift-state">{fx(s.state)} · {fx("revision")} {s.revision}</p>
     {s.comment&&<p>{s.comment}</p>}{s.decision_note&&<p>{fx("disputeReason")}: {s.decision_note}</p>}
     {s.sent?<p>{fx("periodLocked")}</p>:<div className="factory-actions">
      {section==="leader"&&s.source==="self"&&s.state==="needs-review"&&<button type="button" disabled={busy} className="button button--primary" onClick={()=>void act("/shifts/"+s.id+"/review",{revision:s.revision})}>{fx("review")}</button>}
      {section==="leader"&&<button type="button" disabled={busy} className="button button--outline" onClick={()=>setEditing(s)}>{fx("correct")}</button>}
      {section==="worker"&&s.source==="leader"&&s.state==="needs-confirmation"&&<>
       <button type="button" disabled={busy} className="button button--primary" onClick={()=>void act("/shifts/"+s.id+"/confirm",{revision:s.revision})}>{fx("confirm")}</button>
       <label className="field-label"><span>{fx("disputeReason")}</span><textarea maxLength={500} value={notes[s.id]??""} onChange={e=>setNotes(v=>({...v,[s.id]:e.target.value}))}/></label>
       <button type="button" disabled={busy||!(notes[s.id]?.trim().length>=2)} className="button button--outline" onClick={()=>void act("/shifts/"+s.id+"/dispute",{revision:s.revision,note:notes[s.id]})}>{fx("dispute")}</button>
      </>}
     </div>}
     <details><summary>{fx("history")} ({s.history.length})</summary><ol>{s.history.map(h=><li key={h.id}>{fx(h.action)} · {fx("revision")} {h.revision} · {h.before_record?time(h.before_record.start_at)+"–"+time(h.before_record.end_at)+" → ":""}{time(h.after_record.start_at)}–{time(h.after_record.end_at)} · {fx(h.after_record.state)}</li>)}</ol></details>
    </article>)}
   </section>
   {section==="leader"&&<section className="membership-card"><h2>{fx("sendPeriod")}</h2><p>{fx("sendHint")}</p>
    <form className="auth-form membership-grid" onSubmit={e=>{e.preventDefault();void act("/factories/"+factory.id+"/timesheets",{agencyId:agency,dateFrom:from,dateTo:to})}}>
     <label className="field-label membership-wide"><span>{fx("agency")}</span><select id="factory-sheet-agency" required disabled={busy} value={agency} onChange={e=>setAgency(e.target.value)}><option value="">{fx("selectAgency")}</option>{factory.agencies.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     <label className="field-label"><span>{tx("periodFrom")}</span><input id="factory-sheet-from" type="date" required disabled={busy} value={from} onChange={e=>setFrom(e.target.value)}/></label>
     <label className="field-label"><span>{tx("periodTo")}</span><input id="factory-sheet-to" type="date" required min={from} disabled={busy} value={to} onChange={e=>setTo(e.target.value)}/></label>
     <button type="submit" className="button button--primary membership-wide" disabled={busy||!agency||!from||!to}>{fx("sendSheet")}</button>
    </form>
   </section>}
  </>}
  {ctx&&(section==="agency"||section==="leader")&&<section className="membership-card"><h2>{t("agencyArchive.title")}</h2>{!ctx.received.length&&<p>{tx("empty")}</p>}
   {ctx.received.map(sheet=><article className="membership-record" key={sheet.id} data-testid="factory-sheet" data-record-id={sheet.id}>
    <p data-testid="archive-origin">{t("agencyArchive.factory")}</p>
    <h3>{sheet.snapshot.factoryName} · {sheet.date_from} — {sheet.date_to}</h3><p>{sheet.snapshot.agencyName} · {fx("receivedStatus")}</p>
    <p>{tx("total")}: {duration(sheet.snapshot.totalMinutes)} · {sheet.snapshot.totalMinutes} min</p>
    {sheet.snapshot.rows.map(s=><p key={s.id}>{s.workerName} · {s.local_date} · {time(s.start_at)}–{time(s.end_at)} · {duration(s.paid_minutes)} · {fx("revision")} {s.revision}</p>)}
    <button type="button" className="button button--outline" disabled={busy} onClick={()=>void downloadSheet(sheet)}>{t("agencyArchive.download")}</button>
   </article>)}
  </section>}
 </main></div>;
}
