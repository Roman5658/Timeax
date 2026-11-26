import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {TopBar} from "../../components/TopBar";
import {createWorkingRegistrationClient,validEmail,validOtp,type AccessContext} from "../auth/registration/contract/registration-client";
import {createFactoryClient,FactoryError} from "./factory-client";
import "../../styles/membership-hours.css";
type Invite={id:string;factoryId:string;factoryName?:string;email?:string;state:"pending"|"accepted"|"revoked"|"expired";expiresAt:number};
type AdminContext={localOnly:true;csrf:string;factories:{id:string;name:string}[];invitations:Invite[]};
const errorKey=(e:unknown)=>e instanceof FactoryError?e.message:"unavailable";
export function LeaderLoginPanel({onChanged}:{onChanged:()=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t((["login","local","closed","review","created","lostLink","email","unavailable"].includes(k)?"leaderAccess.":"accountantAccess.")+k);
 const auth=useMemo(()=>createWorkingRegistrationClient(location.origin,window.fetch.bind(window),"existing"),[]);
 const [ctx,setCtx]=useState<AccessContext>(),[busy,setBusy]=useState(true),[email,setEmail]=useState(""),[code,setCode]=useState(""),[notice,setNotice]=useState("checking");
 const pending=useRef<AbortController|null>(null);
 const action=useCallback(async(kind:"check"|"send"|"verify"|"logout",address="",otp="")=>{
  if(pending.current)return;const c=new AbortController();pending.current=c;setBusy(true);
  try{
   let message="ready";
   if(kind==="send"){
    const r=await fetch("/api/leader-access/prepare",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",signal:c.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({email:address})});
    if(r.status!==202&&!(r.status===404&&(await auth.context(c.signal))?.capabilities.login))throw new FactoryError(r.status,"unavailable");
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
 const verified=ctx?.state==="verified",verify=ctx?.capabilities.verify,otpLength=ctx?.otpLength??6;
 return <section className="registration-session" aria-label={tx("login")}><h2>{tx("login")}</h2><p>{tx("local")}</p>
  <p role="status" data-testid="leader-session">{tx(busy?"checking":notice)}</p>
  {!verified&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void action(verify?"verify":"send",email.trim().toLowerCase(),code)}}>
   <label className="field-label"><span>{tx("email")}</span><input id="leader-email" type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   {verify&&<label className="field-label"><span>{t("leaderAccess.code",{count:otpLength})}</span><input id="leader-code" inputMode="numeric" autoComplete="one-time-code" pattern={"[0-9]{"+otpLength+"}"} maxLength={otpLength} required disabled={busy} value={code} onChange={e=>setCode(e.target.value)}/></label>}
   <button data-testid="leader-login-submit" className="button button--primary" disabled={busy||!validEmail(email.trim())||!!verify&&!validOtp(code,otpLength)}>{tx(verify?"verify":"send")}</button>
  </form>}
  <button type="button" data-testid="leader-session-refresh" className="button button--outline" disabled={busy} onClick={()=>void action("check")}>{tx("refresh")}</button>
  {verified&&<button type="button" data-testid="leader-logout" className="button button--outline" disabled={busy} onClick={()=>void action("logout")}>{tx("logout")}</button>}
 </section>;
}

export function FactoryLeaderAdminPage(){
 const {t}=useTranslation(),tx=(k:string)=>t('leaderAccess.'+k),common=(k:string)=>t((['closed','review','created','lostLink','email','unavailable'].includes(k)?'leaderAccess.':'accountantAccess.')+k);
 const api=useMemo(()=>createFactoryClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [ctx,setCtx]=useState<AdminContext>(),[reload,setReload]=useState(0),[factoryId,setFactoryId]=useState(''),[email,setEmail]=useState(''),[link,setLink]=useState(''),[notice,setNotice]=useState('checking'),[busy,setBusy]=useState(false);
 const operation=useRef<AbortController|null>(null),mounted=useRef(false);
 const refresh=useCallback(()=>{setCtx(undefined);setLink('');setReload(x=>x+1)},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort()}},[]);
 useEffect(()=>{if(!api){setNotice('closed');return}const c=new AbortController();
  void api.request<AdminContext>('/leaders/context',c.signal).then(v=>{if(!c.signal.aborted){setCtx(v);setNotice(v.factories.length?'ready':'closed')}}).catch(e=>{if(!c.signal.aborted){setCtx(undefined);setNotice(errorKey(e))}});
  return()=>c.abort();
 },[api,reload]);
 async function act(action:'create'|'revoke',input:object){
  if(!api||!ctx||operation.current)return;const c=new AbortController();operation.current=c;setBusy(true);setLink('');
  try{const v=await api.request<Invite&{link?:string}>('/leaders/'+action,c.signal,input,ctx.csrf);
   if(c.signal.aborted||!mounted.current)return;setLink(v.link??'');setNotice(action==='create'?'created':'revoked');
   const next=await api.request<AdminContext>('/leaders/context',c.signal);if(!c.signal.aborted&&mounted.current)setCtx(next);
  }catch(e){if(!c.signal.aborted&&mounted.current){setNotice(errorKey(e));if(e instanceof FactoryError&&e.status===403)setCtx(undefined)}}
  finally{if(operation.current===c)operation.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}
 }
 return <><TopBar/><main className="membership-main"><section className="membership-card"><h1>{tx('manage')}</h1><nav className="factory-links"><Link to="/factory/assignments">{t("factoryPlacement.factoryTitle")}</Link></nav><p>{tx('prerequisite')}</p><LeaderLoginPanel onChanged={refresh}/></section>
  <section className="membership-card"><p role="status">{common(notice)}</p>
   <button type="button" className="button button--outline" disabled={busy} onClick={refresh}>{common('refresh')}</button>
   {!!ctx?.factories.length&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('create',{factoryId,email:email.trim().toLowerCase()})}}>
    <label className="field-label"><span>{t('connectedFactory.factory')}</span><select id="leader-invite-factory" required disabled={busy} value={factoryId} onChange={e=>setFactoryId(e.target.value)}><option value="">{tx('select')}</option>{ctx.factories.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    <label className="field-label"><span>{common('email')}</span><input id="leader-invite-email" type="email" required maxLength={254} disabled={busy} value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <p>{tx('scope')}</p><button className="button button--primary" disabled={busy||!factoryId||!validEmail(email.trim())}>{common('create')}</button>
   </form>}
   {link&&<div className="membership-record"><p>{tx('copyHint')}</p><button className="button button--outline" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice('copied')).catch(()=>setNotice('copyFailed'))}>{common('copy')}</button>{notice==='copyFailed'&&<textarea aria-label={common('copy')} readOnly value={link} onFocus={e=>e.target.select()}/>}</div>}
   {ctx?.invitations.map(i=><article className="membership-record" key={i.id}><h2>{i.factoryName}</h2><p>{i.email} · {common(i.state)}</p><p>{common('expires')}: {new Date(i.expiresAt).toLocaleString()}</p>
    {['pending','accepted'].includes(i.state)&&<button className="button button--outline" disabled={busy} onClick={()=>void act('revoke',{id:i.id})}>{common(i.state==='accepted'?'revokeAccess':'revokeInvite')}</button>}
   </article>)}
  </section></main></>;
}
export function LeaderInvitationPage(){
 const {t}=useTranslation(),tx=(k:string)=>t('leaderAccess.'+k),common=(k:string)=>t((['closed','review','created','lostLink','email','unavailable'].includes(k)?'leaderAccess.':'accountantAccess.')+k);
 const parse=()=>{const m=location.hash.match(/^#([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);return m?{id:m[1],secret:m[2]}:null};
 const [token,setToken]=useState(parse),[invite,setInvite]=useState<Invite>(),[reload,setReload]=useState(0),[notice,setNotice]=useState('signIn'),[busy,setBusy]=useState(false);
 const api=useMemo(()=>createFactoryClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]),operation=useRef<AbortController|null>(null),mounted=useRef(false);
 const refresh=useCallback(()=>{setInvite(undefined);setReload(x=>x+1)},[]);
 useEffect(()=>{mounted.current=true;const reopen=()=>{setToken(parse());setInvite(undefined);setReload(x=>x+1);history.replaceState(history.state,'',location.pathname)};
  history.replaceState(history.state,'',location.pathname);window.addEventListener('hashchange',reopen);
  return()=>{mounted.current=false;operation.current?.abort();window.removeEventListener('hashchange',reopen)};
 },[]);
 useEffect(()=>{if(!api||!token){setNotice('unavailable');return}const c=new AbortController();
  void(async()=>{try{const ctx=await api.context(c.signal),v=await api.request<Invite>('/leaders/inspect',c.signal,token,ctx.csrf);if(!c.signal.aborted){setInvite(v);setNotice(v.state==='accepted'?'accepted':'review')}}catch(e){if(!c.signal.aborted){setInvite(undefined);setNotice(errorKey(e))}}})();return()=>c.abort();
 },[api,token,reload]);
 async function accept(){if(!api||!token||operation.current)return;const c=new AbortController();operation.current=c;setBusy(true);
  try{const ctx=await api.context(c.signal),v=await api.request<Invite>('/leaders/accept',c.signal,token,ctx.csrf);if(!c.signal.aborted&&mounted.current){setInvite(v);setNotice('accepted')}}
  catch(e){if(!c.signal.aborted&&mounted.current){setInvite(undefined);setNotice(errorKey(e))}}
  finally{if(operation.current===c)operation.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}
 }
 return <><TopBar/><main className="membership-main"><section className="membership-card"><h1>{tx('invitation')}</h1><LeaderLoginPanel onChanged={refresh}/></section>
  <section className="membership-card"><p role="status">{common(notice)}</p>{invite?.state==='pending'&&<><h2>{invite.factoryName}</h2><p>{invite.email}</p><p>{tx('scope')}</p><button className="button button--primary" disabled={busy} onClick={()=>void accept()}>{common('accept')}</button></>}
   {invite?.state==='accepted'&&<Link className="button button--primary" to="/leader/team">{tx('open')}</Link>}<p>{common('lostLink')}</p>
  </section></main></>;
}
