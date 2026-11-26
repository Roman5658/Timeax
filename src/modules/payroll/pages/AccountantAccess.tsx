import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {TopBar} from "../../../components/TopBar";
import {createWorkingRegistrationClient,validEmail,validOtp,type AccessContext} from "../../auth/registration/contract/registration-client";
import {createPayslipClient,PayslipError,type PayContext,type PayScope} from "../payslip-client";
import "../../../styles/membership-hours.css";
type Invite={id:string;email:string;state:"pending"|"accepted"|"revoked"|"expired";scopes:PayScope[];expiresAt:number};
const errorKey=(e:unknown)=>e instanceof PayslipError?e.message:"unavailable";
export function AccountantLoginPanel({onChanged}:{onChanged:()=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t("accountantAccess."+k);
 const auth=useMemo(()=>createWorkingRegistrationClient(location.origin,window.fetch.bind(window),"existing"),[]);
 const [ctx,setCtx]=useState<AccessContext>(),[busy,setBusy]=useState(true),[email,setEmail]=useState(""),[code,setCode]=useState(""),[notice,setNotice]=useState("checking");
 const pending=useRef<AbortController|null>(null);
 const action=useCallback(async(kind:"check"|"send"|"verify"|"logout",address="",otp="")=>{
  if(pending.current)return;const c=new AbortController();pending.current=c;setBusy(true);
  try{
   let message="ready";
   if(kind==="send"){
    const r=await fetch("/api/accountant-access/prepare",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",signal:c.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({email:address})});
    if(r.status!==202&&!(r.status===404&&(await auth.context(c.signal))?.capabilities.login))throw new PayslipError(r.status,"unavailable");
    message=await auth.sendCode(address,c.signal)==="accepted"?"codeReady":"closed";
   }
   if(kind==="verify")message=await auth.verifyCode(address,otp,c.signal)==="verified"?"verified":"invalid";
   if(kind==="logout")await auth.logout(c.signal);
   const next=await auth.context(c.signal);if(c.signal.aborted)return;
   setCtx(next);setNotice(next?.state==="verified"?"verified":message);if(kind==="verify"||kind==="logout")setCode("");onChanged();
  }catch(e){if(!c.signal.aborted){setCtx(undefined);setNotice(errorKey(e));onChanged()}}
  finally{if(pending.current===c)pending.current=null;if(!c.signal.aborted)setBusy(false)}
 },[auth,onChanged]);
 useEffect(()=>{void action("check");return()=>{pending.current?.abort();pending.current=null}},[action]);
 useEffect(()=>{if(ctx?.state!=="verified")return;const timer=setTimeout(()=>void action("check"),Math.max(1,Date.parse(ctx.session.expiresAt)-Date.parse(ctx.session.serverTime)+50));return()=>clearTimeout(timer)},[ctx,action]);
 const verified=ctx?.state==="verified",verify=ctx?.capabilities.verify;
 return <section className="registration-session" aria-label={tx("login")}><h2>{tx("login")}</h2><p>{tx("local")}</p>
  <p role="status" data-testid="accountant-session">{tx(busy?"checking":notice)}</p>
  {!verified&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void action(verify?"verify":"send",email.trim().toLowerCase(),code)}}>
   <label className="field-label"><span>{tx("email")}</span><input id="accountant-email" type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   {verify&&<label className="field-label"><span>{tx("code")}</span><input id="accountant-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={code} onChange={e=>setCode(e.target.value)}/></label>}
   <button data-testid="accountant-login-submit" className="button button--primary" disabled={busy||!validEmail(email.trim())||!!verify&&!validOtp(code)}>{tx(verify?"verify":"send")}</button>
  </form>}
  <button type="button" data-testid="accountant-session-refresh" className="button button--outline" disabled={busy} onClick={()=>void action("check")}>{tx("refresh")}</button>
  {verified&&<button type="button" data-testid="accountant-logout" className="button button--outline" disabled={busy} onClick={()=>void action("logout")}>{tx("logout")}</button>}
 </section>;
}
export function AccountantAccess({ctx,onChanged}:{ctx:PayContext;onChanged:()=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t("accountantAccess."+k),api=useMemo(()=>createPayslipClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [email,setEmail]=useState(""),[selected,setSelected]=useState<string[]>([]),[items,setItems]=useState<Invite[]>([]),[link,setLink]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("hint");
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{const c=new AbortController();void api?.request<{invitations:Invite[]}>("/accountants/list",c.signal).then(v=>{if(!c.signal.aborted)setItems(v.invitations)}).catch(e=>{if(!c.signal.aborted)setNotice(errorKey(e))});return()=>{c.abort();pending.current?.abort()}},[api,ctx]);
 async function act(action:"create"|"revoke",input:object){
  if(!api||pending.current)return;const c=new AbortController();pending.current=c;setBusy(true);setLink("");
  try{const r=await api.request<Invite&{link?:string}>("/accountants/"+action,c.signal,input,ctx.csrf);
   const list=await api.request<{invitations:Invite[]}>("/accountants/list",c.signal);if(c.signal.aborted)return;
   setItems(list.invitations);setLink(r.link??"");setNotice(action==="create"?"created":"revoked");if(action==="revoke")onChanged();
  }catch(e){if(!c.signal.aborted)setNotice(errorKey(e))}finally{if(pending.current===c)pending.current=null;if(!c.signal.aborted)setBusy(false)}
 }
 return <details className="membership-card" data-testid="accountant-access"><summary>{tx("manage")}</summary><p>{tx("hint")}</p>
  <form className="membership-grid" onSubmit={e=>{e.preventDefault();void act("create",{email:email.trim().toLowerCase(),scopes:ctx.scopes.filter(s=>selected.includes(s.kind+s.agencyId)).map(({kind,agencyId})=>({kind,agencyId}))})}}>
   <label className="field-label membership-wide"><span>{tx("email")}</span><input id="invite-email" type="email" autoComplete="off" required maxLength={254} disabled={busy} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <fieldset className="membership-wide"><legend>{tx("scope")}</legend>{ctx.scopes.map(s=>{const key=s.kind+s.agencyId;return <label className="checkbox-field" key={key}><input data-testid="invite-scope" type="checkbox" disabled={busy} checked={selected.includes(key)} onChange={e=>setSelected(e.target.checked?[...selected,key]:selected.filter(x=>x!==key))}/><span>{s.name} / {t("localPayslip."+s.kind)}</span></label>})}</fieldset>
   <button data-testid="invite-create" className="button button--primary" disabled={busy||!validEmail(email.trim())||!selected.length}>{tx("create")}</button>
  </form><p role="status" data-testid="invite-status">{tx(notice)}</p>
  {link&&<div className="membership-record"><p>{tx("copyHint")}</p><button data-testid="invite-copy" type="button" className="button button--outline" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice("copied")).catch(()=>setNotice("copyFailed"))}>{tx("copy")}</button></div>}
  {items.map(i=><article className="membership-record" key={i.id} data-testid="accountant-invitation" data-record-id={i.id}>
   <p>{i.email} / <strong>{tx(i.state)}</strong></p><p>{tx("expires")}: {new Date(i.expiresAt).toLocaleString()}</p>
   <p>{i.scopes.map(s=>ctx.scopes.find(x=>x.kind===s.kind&&x.agencyId===s.agencyId)).filter(Boolean).map(s=>s!.name+" ("+t("localPayslip."+s!.kind)+")").join(", ")}</p>
   {["pending","accepted"].includes(i.state)&&<button data-testid="invite-revoke" type="button" className="button button--outline" disabled={busy} onClick={()=>void act("revoke",{id:i.id})}>{tx(i.state==="accepted"?"revokeAccess":"revokeInvite")}</button>}
  </article>)}
 </details>;
}
export function AccountantInvitationPage(){
 const {t}=useTranslation(),tx=(k:string)=>t("accountantAccess."+k);
 const [token,setToken]=useState(()=>{const m=location.hash.match(/^#([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);return m?{id:m[1],secret:m[2]}:null});
 const api=useMemo(()=>createPayslipClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [reload,setReload]=useState(0),[invite,setInvite]=useState<Invite>(),[notice,setNotice]=useState("signIn"),[busy,setBusy]=useState(false);
 const changed=useCallback(()=>{setInvite(undefined);setReload(x=>x+1)},[]);
 useEffect(()=>{
  const reopen=()=>{const m=location.hash.match(/^#([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);if(m){setToken({id:m[1],secret:m[2]});setInvite(undefined);setReload(x=>x+1)}history.replaceState(history.state,"",location.pathname)};
  history.replaceState(history.state,"",location.pathname);window.addEventListener("hashchange",reopen);
  return()=>window.removeEventListener("hashchange",reopen);
 },[]);
 useEffect(()=>{if(!api||!token){setNotice("unavailable");return}const c=new AbortController();
  void (async()=>{try{const ctx=await api.context(c.signal);const v=await api.request<Invite>("/accountants/inspect",c.signal,token,ctx.csrf);if(!c.signal.aborted){setInvite(v);setNotice(v.state==="accepted"?"accepted":"review")}}
   catch(e){if(!c.signal.aborted)setNotice(e instanceof PayslipError&&e.status===403?"signIn":errorKey(e))}})();return()=>c.abort();
 },[api,token,reload]);
 async function accept(){if(!api||!token||busy)return;setBusy(true);const c=new AbortController();
  try{const ctx=await api.context(c.signal),v=await api.request<Invite>("/accountants/accept",c.signal,token,ctx.csrf);setInvite(v);setNotice("accepted")}
  catch(e){setInvite(undefined);setNotice(errorKey(e))}finally{setBusy(false)}
 }
 return <><TopBar/><main className="membership-main"><section className="membership-card"><h1>{tx("invitation")}</h1><p>{tx("local")}</p><AccountantLoginPanel onChanged={changed}/></section>
  <section className="membership-card"><p role="status" data-testid="invitation-result">{tx(notice)}</p>{invite?.state==="pending"&&<><p>{invite.email}</p>{invite.scopes.map(s=><p key={s.kind+s.agencyId}>{s.name} / {t("localPayslip."+s.kind)}</p>)}<p>{tx("acceptHint")}</p><button data-testid="invite-accept" className="button button--primary" disabled={busy} onClick={()=>void accept()}>{tx("accept")}</button></>}
  {invite?.state==="accepted"&&<Link data-testid="accountant-open" className="button button--primary" to="/accountant/payroll">{tx("open")}</Link>}
  <p>{tx("lostLink")}</p></section></main></>;
}
