import {useEffect,useRef,useState} from "react";
import {ownerSupportCopy} from "./owner-support-copy";

type Membership={id:string;organizationId:string;organizationName:string;kind:string;role:string;state:string};
type Account={id:string;email:string|null;createdAt:string;verified:boolean;lastSignInAt:string|null;bannedUntil:string|null;hasPassword:boolean;activeSessions:number;memberships:Membership[]};
type Shift={id:string;source:"agency"|"factory";organizationName:string;worksiteName:string|null;day:string;start:string;end:string;revision:number;state:string;editable:boolean};
type History={id:string;action:string;objectId:string|null;reason:string;at:string;before:Record<string,unknown>;after:Record<string,unknown>};
type Call=<T>(body:object,signal?:AbortSignal)=>Promise<T>;
const warsawDay=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const previous=(day:string,n:number)=>new Date(Date.parse(day)-n*86400000).toISOString().slice(0,10);
const validRange=(from:string,to:string)=>!!from&&!!to&&from<=to&&Date.parse(to)-Date.parse(from)<=30*86400000;

export function OwnerSupportPanel({accountId,lang,call,onClose}:{accountId:string;lang:string;call:Call;onClose:()=>void}){
 const copy=ownerSupportCopy[lang as keyof typeof ownerSupportCopy]??ownerSupportCopy.en;
 const title=useRef<HTMLHeadingElement>(null),api=useRef(call);api.current=call;
 const [tab,setTab]=useState<"details"|"shifts"|"history">("details");
 const [account,setAccount]=useState<Account>(),[shifts,setShifts]=useState<Shift[]>(),[events,setEvents]=useState<History[]>();
 const [truncated,setTruncated]=useState(false),[loading,setLoading]=useState(false),[changing,setChanging]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[refresh,reload]=useState(0);
 const [period,setPeriod]=useState(()=>{const to=warsawDay();return {from:previous(to,13),to}});
 const [draft,setDraft]=useState(period);
 const [edit,setEdit]=useState<Shift>(),[revoke,setRevoke]=useState(false),[reason,setReason]=useState("");
 const [start,setStart]=useState(""),[end,setEnd]=useState("");
 const pending=useRef(false);
 const fmt=new Intl.DateTimeFormat(lang,{dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Warsaw"});
 const print=(d:string|null)=>d&&Number.isFinite(Date.parse(d))?fmt.format(new Date(d)):"—";
 function translateError(e:unknown){
  const id=e instanceof Error?e.message:"";
  return id==="support-not-configured"?copy.unconfigured:id==="changed"?copy.changed:id==="blocked"?copy.blocked:id==="missing"?copy.missing:copy.error;
 }
 useEffect(()=>{title.current?.focus()},[]);
 useEffect(()=>{
  const c=new AbortController();setLoading(true);setError("");
  async function load(){
   try{
    if(tab==="details"){
     const r=await api.current<{account:Account}>({action:"support-account",accountId},c.signal);
     if(!c.signal.aborted)setAccount(r.account);
    }else if(tab==="shifts"){
     const r=await api.current<{shifts:Shift[];truncated:boolean}>({action:"support-shifts",accountId,...period},c.signal);
     if(!c.signal.aborted){setShifts(r.shifts);setTruncated(r.truncated)}
    }else{
     const r=await api.current<{events:History[]}>({action:"support-audit",accountId},c.signal);
     if(!c.signal.aborted)setEvents(r.events);
    }
   }catch(e){if(!c.signal.aborted)setError(translateError(e))}
   finally{if(!c.signal.aborted)setLoading(false)}
  }
  void load();return()=>c.abort();
 },[accountId,tab,period,refresh,copy]);
 function pick(which:typeof tab){setEdit(undefined);setRevoke(false);setReason("");setNotice("");setError("");setTab(which)}
 async function save(){
  if(pending.current||reason.trim().length<3)return;
  pending.current=true;setChanging(true);setError("");setNotice("");
  try{
   if(edit){
    const result=await api.current<{state:string}>({action:"support-correct-shift",accountId,id:edit.id,source:edit.source,
     revision:edit.revision,start,end,reason:reason.trim()});
    if(result.state!=="corrected")throw Error("unavailable");
    setNotice(copy.saved);
   }else if(revoke){
    const result=await api.current<{state:string}>({action:"support-revoke-sessions",accountId,reason:reason.trim()});
    if(result.state!=="revoked")throw Error("unavailable");
    setNotice(copy.revoked);
   }else return;
   setEdit(undefined);setRevoke(false);setReason("");reload(v=>v+1);
  }catch(e){if(e instanceof Error&&e.message==="changed"){setNotice(copy.changed);setEdit(undefined);reload(v=>v+1)}else setError(translateError(e))}
  finally{pending.current=false;setChanging(false)}
 }
 const auditValue=(v:Record<string,unknown>)=>Object.entries(v).map(([k,n])=>(copy.fields[k as keyof typeof copy.fields]??k)+": "+String(n??"—")).join(" · ")||"—";
 return <section className="owner-panel__card owner-panel__leaf owner-panel__support" aria-labelledby="owner-support-title">
  <div className="owner-panel__heading"><h2 ref={title} tabIndex={-1} id="owner-support-title">{copy.title}</h2>
   <button type="button" className="button button--outline" disabled={changing} onClick={onClose}>{copy.close}</button>
  </div>
  <p>{account?.email??accountId}</p>
  <div className="form-actions" aria-label={copy.title}>
   {(["details","shifts","history"] as const).map(which=><button key={which} type="button" aria-pressed={tab===which}
    className={"button "+(which===tab?"button--primary":"button--outline")} disabled={changing} onClick={()=>pick(which)}>{copy[which]}</button>)}
  </div>
  {loading&&<p role="status">{copy.loading}</p>}
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {tab==="details"&&account&&!loading&&<>
   <dl className="owner-panel__support-details">
    <dt>{copy.verified}</dt><dd>{account.verified?copy.yes:copy.no}</dd>
    <dt>{copy.passwordSet}</dt><dd>{account.hasPassword?copy.yes:copy.no}</dd>
    <dt>{copy.created}</dt><dd>{print(account.createdAt)}</dd>
    <dt>{copy.lastSignIn}</dt><dd>{print(account.lastSignInAt)}</dd>
    <dt>{copy.bannedUntil}</dt><dd>{print(account.bannedUntil)}</dd>
    <dt>{copy.sessions}</dt><dd>{account.activeSessions}</dd>
   </dl>
   <h3>{copy.memberships}</h3>
   {account.memberships.length?<ul className="owner-panel__accounts">{account.memberships.map(m=><li key={m.id}>
    <div><strong>{m.organizationName}</strong><p>{copy.roles[m.role as keyof typeof copy.roles]??m.role} · {copy.states[m.state as keyof typeof copy.states]??m.state}</p></div>
   </li>)}</ul>:<p>{copy.emptyMemberships}</p>}
   {!revoke&&<button type="button" className="button button--outline" disabled={changing} onClick={()=>{setRevoke(true);setError("");setNotice("")}}>{copy.revoke}</button>}
  </>}
  {tab==="shifts"&&<>
   <form className="owner-panel__filters" onSubmit={e=>{e.preventDefault();if(validRange(draft.from,draft.to)){setShifts(undefined);setEdit(undefined);setNotice("");setPeriod({...draft})}}}>
    <label className="field-label">{copy.from}<input type="date" required value={draft.from} disabled={changing} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
    <label className="field-label">{copy.to}<input type="date" required value={draft.to} disabled={changing} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
    <button className="button button--outline" disabled={changing||loading||!validRange(draft.from,draft.to)}>{copy.show}</button>
   </form>
   <p className="muted-copy">{copy.range}</p>
   {truncated&&!loading&&<p role="status">{copy.truncated}</p>}
   {shifts&&!loading&&!shifts.length&&<p>{copy.emptyShifts}</p>}
   {!!shifts?.length&&!loading&&<ul className="owner-panel__accounts">{shifts.map(s=><li key={s.source+s.id}>
    <div><strong>{s.day} · {s.start}–{s.end}</strong><p>{copy[s.source]}: {s.organizationName}{s.worksiteName?" · "+s.worksiteName:""}</p>
    <p>{copy.states[s.state as keyof typeof copy.states]??s.state} · {copy.revision} {s.revision}</p></div>
    {s.editable?<button type="button" className="button button--outline" disabled={changing} onClick={()=>{setEdit(s);setStart(s.start);setEnd(s.end);setReason("");setNotice("");setError("")}}>{copy.correct}</button>:<small>{copy.readOnly}</small>}
   </li>)}</ul>}
  </>}
  {tab==="history"&&events&&!loading&&<>
   {!events.length&&<p>{copy.emptyHistory}</p>}
   <ul className="owner-panel__accounts">{events.map(e=><li key={e.id}><div><strong>{e.action==="revoke-sessions"?copy.revoke:e.action==="correct-shift"?copy.correct:e.action} · {print(e.at)}</strong>
    <p>{copy.reason}: {e.reason}</p><p>{copy.before}: {auditValue(e.before)}</p><p>{copy.after}: {auditValue(e.after)}</p></div></li>)}</ul>
  </>}
  {(edit||revoke)&&<form className="auth-form notice-box" onSubmit={e=>{e.preventDefault();void save()}}>
   <h3>{edit?copy.correct+" · "+edit.day:copy.revoke}</h3>
   {edit?<div className="owner-panel__filters">
    <label className="field-label">{copy.start}<input type="time" value={start} disabled={changing} required onChange={e=>setStart(e.target.value)}/></label>
    <label className="field-label">{copy.end}<input type="time" value={end} disabled={changing} required onChange={e=>setEnd(e.target.value)}/></label>
   </div>:<p>{copy.revokeWarning}</p>}
   <label className="field-label">{copy.reason}<textarea rows={2} minLength={3} maxLength={200} value={reason} disabled={changing} required onChange={e=>setReason(e.target.value)}/></label>
   <div className="form-actions">
    <button className="button button--primary" disabled={changing||reason.trim().length<3||!!edit&&(!start||!end||start===end||start===edit.start&&end===edit.end)}>{copy.confirm}</button>
    <button type="button" className="button button--outline" disabled={changing} onClick={()=>{setEdit(undefined);setRevoke(false);setReason("");setError("")}}>{copy.cancel}</button>
   </div>
  </form>}
 </section>;
}
