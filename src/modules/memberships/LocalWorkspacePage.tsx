import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {TopBar} from "../../components/TopBar";
import {StagingSessionPanel} from "../auth/pages/StagingSessionPanel";
import {createWorkspaceClient,WorkspaceError,type WorkspaceContext,type WorkspaceData,type JoinRequest,type InternalTimesheet} from "./workspace-client";
import {AgencyTimesheetNav} from "../monthly-timesheets/AgencyTimesheetNav";
import {InternalTimesheetView} from "./InternalTimesheetView";
import {internalTimesheetCsv} from "./internal-timesheet";
import "../../styles/membership-hours.css";
type Section="operator"|"agency"|"worker";
const dateToday=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export function LocalWorkspacePage({section}:{section:Section}){
 const {t}=useTranslation();const tx=(key:string)=>t("localWorkspace."+key);
 const api=useMemo(()=>createWorkspaceClient(import.meta.env.MODE,window.location.origin,window.fetch.bind(window)),[]);
 const [ctx,setCtx]=useState<WorkspaceContext>(),[data,setData]=useState<WorkspaceData>({}),[revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(true),[notice,setNotice]=useState("checking"),[siteName,setSiteName]=useState("");
 const [confirmAgency,setConfirmAgency]=useState<Record<string,boolean>>({}),[accept,setAccept]=useState<Record<string,{site:string;start:string;confirm:boolean}>>({});
 const [employment,setEmployment]=useState(""),[date,setDate]=useState(dateToday),[start,setStart]=useState("08:00"),[end,setEnd]=useState("16:00");
 const [breakStatus,setBreakStatus]=useState("not-taken"),[breakMinutes,setBreakMinutes]=useState(0),[treatment,setTreatment]=useState("unpaid"),[comment,setComment]=useState("");
 const [sheetFolder,setSheetFolder]=useState(""),[dateFrom,setDateFrom]=useState(""),[dateTo,setDateTo]=useState(""),[sheetId,setSheetId]=useState("");
 const operation=useRef<AbortController|null>(null),mounted=useRef(false),submission=useRef<{fingerprint:string;id:string}|undefined>(undefined);
 const refresh=useCallback(()=>{setCtx(undefined);setData({});setRevision(v=>v+1)},[]);
 const allowed=(c:WorkspaceContext)=>section==="operator"?c.operator:c.memberships.some(m=>m.role===(section==="agency"?"agency":"worker"));
 async function loadData(signal:AbortSignal){
  const result=await api!.request<WorkspaceData>(route,signal);
  if(section==="agency"){
   const hours=await api!.request<WorkspaceData>("/agency-shifts",signal),sheets=await api!.request<WorkspaceData>("/internal-timesheets",signal);
   result.shifts=hours.shifts;result.timesheets=sheets.timesheets;
  }
  return result;
 }
 const selectedSheet=data.timesheets?.find(s=>s.id===sheetId)??data.timesheets?.[0];
 const route=section==="operator"?"/agency-applications":section==="agency"?"/worker-requests":"/worker-hours";
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();operation.current=controller;setBusy(true);
  void (async()=>{
   try{if(!api)throw new WorkspaceError(403);const context=await api.context(controller.signal);
    if(!allowed(context))throw new WorkspaceError(403);
    const result=await loadData(controller.signal);
    if(!controller.signal.aborted){setCtx(context);setData(result);setNotice("ready");setEmployment(current=>result.placements?.some(p=>p.employmentId===current)?current:result.placements?.[0]?.employmentId??"")}
   }catch(error){if(!controller.signal.aborted){setCtx(undefined);setData({});setNotice(error instanceof WorkspaceError?error.message:"unavailable")}}
   finally{if(operation.current===controller)operation.current=null;if(!controller.signal.aborted)setBusy(false)}
  })();
  return()=>{mounted.current=false;controller.abort();operation.current?.abort();operation.current=null};
 },[api,revision,section]);
 async function act(path:string,input:object){
  if(!api||!ctx||operation.current)return;const controller=new AbortController();operation.current=controller;setBusy(true);
  try{
   const created=await api.request<{id?:string}>(path,controller.signal,input,ctx.csrf);
   if(path==="/internal-timesheets"&&created.id)setSheetId(created.id);
   const context=await api.context(controller.signal);if(!allowed(context))throw new WorkspaceError(403);
   const result=await loadData(controller.signal);
   if(mounted.current&&!controller.signal.aborted){setData(result);setCtx(context);setNotice("saved")}
  }catch(error){if(mounted.current&&!controller.signal.aborted){setNotice(error instanceof WorkspaceError?error.message:"uncertain");if(error instanceof WorkspaceError&&error.status===403){setCtx(undefined);setData({})}}}
  finally{if(operation.current===controller)operation.current=null;if(mounted.current&&!controller.signal.aborted)setBusy(false)}
 }
 async function downloadSheet(sheet:InternalTimesheet){
  if(!api||operation.current)return;const controller=new AbortController();operation.current=controller;setBusy(true);
  try{
   const fresh=await api.request<InternalTimesheet>("/internal-timesheets/"+sheet.id,controller.signal);
   if(controller.signal.aborted||!mounted.current)return;
   const url=URL.createObjectURL(new Blob([internalTimesheetCsv(fresh)],{type:"text/csv;charset=utf-8"}));
   const link=document.createElement("a");link.href=url;link.download="timeax-"+fresh.date_from+"-"+fresh.date_to+"-"+fresh.id+".csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){if(mounted.current){setNotice(error instanceof WorkspaceError?error.message:"unavailable");if(error instanceof WorkspaceError&&error.status===403){setCtx(undefined);setData({})}}}
  finally{if(operation.current===controller)operation.current=null;if(mounted.current)setBusy(false)}
 }
 function acceptValues(r:JoinRequest){return accept[r.id]??{site:"",start:"",confirm:false}}
 function updateAccept(r:JoinRequest,value:Partial<{site:string;start:string;confirm:boolean}>){setAccept(current=>({...current,[r.id]:{...acceptValues(r),...value}}))}
 function saveHours(event:FormEvent){
  event.preventDefault();const input={employmentId:employment,localDate:date,startTime:start,endTime:end,breakStatus,breakMinutes,breakTreatment:treatment,comment};
  const fingerprint=JSON.stringify(input);if(submission.current?.fingerprint!==fingerprint)submission.current={fingerprint,id:crypto.randomUUID()};
  void act("/worker-shifts",{...input,submissionId:submission.current.id});
 }
 return <div className="auth-page"><TopBar/><main className="membership-main">
  <section className="membership-card"><Link to="/login" className="back-link">{tx("signIn")}</Link><h1>{tx(section+"Title")}</h1>
  {section==="worker"&&<Link to="/worker/payslips">{t("localPayslip.workerTitle")}</Link>}
   <p className="notice-box notice-box--warm">{tx("localNotice")}</p>
    {section==="agency"&&<AgencyTimesheetNav active="internal"/>}
   {section==="agency"&&<Link to="/agency/factory-assignments">{t("factoryPlacement.agencyTitle")}</Link>}
   {section==="worker"&&<Link to="/worker/factory-assignments">{t("factoryPlacement.workerTitle")}</Link>}
   {section==="agency"&&<Link to="/agency/factory-connections">{t("factoryOnboarding.connectionsTitle")}</Link>}
    <StagingSessionPanel purpose="existing" audience="workspace" onChanged={refresh}/>
   <p role="status" data-testid="workspace-status" className="notice-box">{tx(busy?"checking":notice)}</p>
   <button type="button" className="button button--outline" disabled={busy} onClick={refresh}>{tx("refresh")}</button>
  </section>
  {!busy&&ctx&&section==="operator"&&<section className="membership-card"><h2>{tx("applications")}</h2>
   {!data.applications?.length&&<p>{tx("empty")}</p>}
   {data.applications?.map(a=><article key={a.id} className="membership-record" data-testid="agency-application" data-record-id={a.id}>
    <h3>{a.name}</h3><p>NIP {a.nip}</p><p>{tx(a.state)}</p>
    {a.state==="pending"&&<><label className="membership-check"><input type="checkbox" checked={confirmAgency[a.id]??false} onChange={e=>setConfirmAgency(v=>({...v,[a.id]:e.target.checked}))}/>{tx("confirmIdentity")}</label>
     <button className="button button--primary" disabled={!confirmAgency[a.id]} onClick={()=>void act("/agency-applications/"+a.id+"/approve",{confirmIdentity:true})}>{tx("approveAgency")}</button></>}
   </article>)}</section>}
  {!busy&&ctx&&section==="agency"&&<>
   <section className="membership-card"><h2>{ctx.memberships.find(m=>m.role==="agency")?.organizationName}</h2><h3>{tx("worksites")}</h3>
    <p>{tx("worksiteHint")}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();void act("/worksites",{name:siteName})}}>
     <label className="field-label"><span>{tx("worksiteName")}</span><input id="workspace-site-name" value={siteName} maxLength={120} minLength={2} required onChange={e=>setSiteName(e.target.value)}/></label>
     <button className="button button--outline" type="submit">{tx("createWorksite")}</button>
    </form>{data.worksites?.map(s=><p key={s.id}>{s.name}</p>)}
   </section>
   <section className="membership-card"><h2>{tx("requests")}</h2>{!data.requests?.length&&<p>{tx("empty")}</p>}
    {data.requests?.map(r=>{const v=acceptValues(r);return <article key={r.id} className="membership-record" data-testid="agency-worker-request" data-record-id={r.id}>
     <h3>{r.name}</h3><p data-testid="request-state">{tx(r.state==="approved"?"approved":"pending")}</p>
     {r.state==="awaiting-approval"&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act("/worker-requests/"+r.id+"/approve",{worksiteId:v.site,startDate:v.start,confirmEmployment:v.confirm})}}>
      <label className="field-label"><span>{tx("worksite")}</span><select aria-label={tx("worksite")} value={v.site} required onChange={e=>updateAccept(r,{site:e.target.value})}><option value="">{tx("select")}</option>{data.worksites?.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="field-label"><span>{tx("employmentStart")}</span><input type="date" aria-label={tx("employmentStart")} value={v.start} required onChange={e=>updateAccept(r,{start:e.target.value})}/></label>
      <label className="membership-check"><input type="checkbox" checked={v.confirm} onChange={e=>updateAccept(r,{confirm:e.target.checked})}/>{tx("confirmEmployment")}</label>
      <button className="button button--primary" type="submit" disabled={!v.site||!v.start||!v.confirm}>{tx("acceptWorker")}</button>
     </form>}
    </article>})}
   </section>
  </>}
  {!busy&&ctx&&section==="agency"&&<>
   <section className="membership-card"><h2>{tx("agencyHours")}</h2><p>{tx("directHoursHint")}</p>
    {!data.shifts?.length&&<p>{tx("empty")}</p>}
    {data.shifts?.map(s=><article key={s.id} className="membership-record" data-testid="agency-shift" data-record-id={s.id}>
     <h3>{s.worker_name} · {s.local_date}</h3><p>{tx("worksite")}: {s.worksite_name}</p>
     <p>{new Intl.DateTimeFormat(undefined,{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit"}).format(new Date(s.start_at))}–{new Intl.DateTimeFormat(undefined,{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit"}).format(new Date(s.end_at))} · Europe/Warsaw</p>
     <p>{tx("gross")}: {s.gross_minutes} min · {tx("breakMinutes")}: {s.break_minutes} min · {tx("paidTime")}: {s.paid_minutes} min</p>
     <p>{tx("shiftRecorded")}</p>{s.comment&&<p>{s.comment}</p>}
    </article>)}
   </section>
   <section className="membership-card" id="timesheets"><h2>{tx("periodTimesheet")}</h2><p data-testid="archive-origin">{t("agencyArchive.internal")}</p><p>{tx("timesheetHint")}</p>
    <form className="auth-form membership-grid" onSubmit={e=>{e.preventDefault();void act("/internal-timesheets",{worksiteId:sheetFolder,dateFrom,dateTo})}}>
     <label className="field-label membership-wide"><span>{tx("worksite")}</span><select id="timesheet-folder" required value={sheetFolder} onChange={e=>setSheetFolder(e.target.value)}><option value="">{tx("select")}</option>{data.worksites?.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
     <label className="field-label"><span>{tx("periodFrom")}</span><input id="timesheet-from" type="date" required value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
     <label className="field-label"><span>{tx("periodTo")}</span><input id="timesheet-to" type="date" required min={dateFrom} value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
     <button type="submit" className="button button--primary membership-wide" disabled={!sheetFolder||!dateFrom||!dateTo}>{tx("createTimesheet")}</button>
    </form>
    {!!data.timesheets?.length&&<label className="field-label"><span>{tx("savedTimesheets")}</span><select id="saved-timesheets" value={selectedSheet?.id??""} onChange={e=>setSheetId(e.target.value)}>{data.timesheets.map(s=><option key={s.id} value={s.id}>{s.snapshot.folderName} · {s.date_from} — {s.date_to} · {s.created_at}</option>)}</select></label>}
    {selectedSheet&&<InternalTimesheetView sheet={selectedSheet} onDownload={()=>void downloadSheet(selectedSheet)}/>}
   </section>
  </>}
  {!busy&&ctx&&section==="worker"&&<>
   <section className="membership-card"><h2>{tx("ownHours")}</h2><p>{tx("hoursHint")}</p>
    <form className="auth-form membership-grid" onSubmit={saveHours}>
     <label className="field-label membership-wide"><span>{tx("worksite")}</span><select id="hours-employment" value={employment} required onChange={e=>setEmployment(e.target.value)}>{data.placements?.map(p=><option key={p.employmentId} value={p.employmentId}>{p.agencyName} · {p.worksiteName} · {p.startDate}</option>)}</select></label>
     <label className="field-label"><span>{tx("date")}</span><input id="hours-date" type="date" value={date} required onChange={e=>setDate(e.target.value)}/></label>
     <label className="field-label"><span>{tx("start")}</span><input id="hours-start" type="time" value={start} required onChange={e=>setStart(e.target.value)}/></label>
     <label className="field-label"><span>{tx("end")}</span><input id="hours-end" type="time" value={end} required onChange={e=>setEnd(e.target.value)}/></label>
     <label className="field-label"><span>{tx("breakStatus")}</span><select id="hours-break-status" value={breakStatus} onChange={e=>{setBreakStatus(e.target.value);if(e.target.value==="not-taken")setBreakMinutes(0)}}><option value="not-taken">{tx("noBreak")}</option><option value="taken">{tx("breakTaken")}</option></select></label>
     <label className="field-label"><span>{tx("breakMinutes")}</span><input id="hours-break-minutes" type="number" min={breakStatus==="taken"?1:0} max={1439} value={breakMinutes} required disabled={breakStatus==="not-taken"} onChange={e=>setBreakMinutes(Number(e.target.value))}/></label>
     <label className="field-label"><span>{tx("treatment")}</span><select id="hours-treatment" value={treatment} onChange={e=>setTreatment(e.target.value)}><option value="unpaid">{tx("unpaid")}</option><option value="paid">{tx("paid")}</option></select></label>
     <label className="field-label membership-wide"><span>{tx("comment")}</span><textarea id="hours-comment" value={comment} maxLength={500} onChange={e=>setComment(e.target.value)}/></label>
     <button className="button button--primary membership-wide" type="submit">{tx("saveHours")}</button>
    </form>
   </section>
   <section className="membership-card"><h2>{tx("recordedHours")}</h2>{!data.shifts?.length&&<p>{tx("empty")}</p>}
    {data.shifts?.map(s=><article key={s.id} className="membership-record" data-testid="own-shift" data-record-id={s.id}>
     <h3>{s.local_date}</h3><p>{new Intl.DateTimeFormat(undefined,{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit"}).format(new Date(s.start_at))}–{new Intl.DateTimeFormat(undefined,{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit"}).format(new Date(s.end_at))} · Europe/Warsaw</p>
     <p>{tx("gross")}: {s.gross_minutes} min · {tx("breakMinutes")}: {s.break_minutes} min · {tx("paidTime")}: {s.paid_minutes} min</p>
     <p>{tx("shiftRecorded")}</p>{s.comment&&<p>{s.comment}</p>}
    </article>)}
   </section>
  </>}
 </main></div>;
}
