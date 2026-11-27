import { useState,type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { accountAdminCopy } from "./account-admin-copy";
import { RegistrationFrame } from "../components/PublicExperience";

type Account={id:string;email:string|null;createdAt:string;verified:boolean};
type Preview={id:string;email:string;scope:string;canDelete:boolean;token:string|null};
const keyPattern=/^[-_A-Za-z0-9]{43,128}$/;

export function AccountAdminPage(){
 const {t,i18n}=useTranslation();
 const lang=(i18n.resolvedLanguage??"en").split("-")[0] as keyof typeof accountAdminCopy;
 const strings:Record<string,string>=accountAdminCopy[lang]??accountAdminCopy.en;
 const tx=(key:string)=>strings[key]??strings.unavailable;
 const [key,setKey]=useState(""),[accounts,setAccounts]=useState<Account[]|null>(null);
 const [page,setPage]=useState<string|null>(null),[next,setNext]=useState<string|null>(null);
 const [preview,setPreview]=useState<Preview|null>(null),[confirm,setConfirm]=useState("");
 const [busy,setBusy]=useState(false),[status,setStatus]=useState("");
 async function call(body:object){
  const r=await fetch("/api/timeax/account-admin",{method:"POST",cache:"no-store",credentials:"same-origin",redirect:"error",
   headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const v=await r.json();
  if(!r.ok)throw Error(v.error);
  return v;
 }
 async function load(after:string|null){
  const v=await call({action:"list",after});
  if(!Array.isArray(v.accounts))throw Error("unavailable");
  setAccounts(v.accounts);setPage(after);setNext(v.next);
 }
 async function run(fn:()=>Promise<void>){
  if(busy||!keyPattern.test(key))return;
  setBusy(true);setStatus("");
  try{await fn()}catch(e){
   const reason=(e as Error)?.message;
   if(reason==="denied"){setAccounts(null);setPreview(null);}
   setStatus(["admin-not-configured","denied","blocked","changed","wait","missing"].includes(reason)?reason:"unavailable");
  }finally{setBusy(false)}
 }
 function unlock(e:FormEvent){e.preventDefault();void run(()=>load(null))}
 function lock(){setKey("");setAccounts(null);setPage(null);setNext(null);setPreview(null);setConfirm("");setStatus("")}
 return <RegistrationFrame title={tx("title")} lead={tx("lead")} back="/">
  {!accounts?<form className="auth-form" onSubmit={unlock}>
   <label className="field-label">{tx("key")}<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} disabled={busy} required maxLength={128}/></label>
   <button className="button button--primary" disabled={busy||!keyPattern.test(key)}>{tx("open")}</button>
  </form>:<>
   <button type="button" className="button button--outline" disabled={busy} onClick={lock}>{tx("lock")}</button>
   {!accounts.length&&<p>{tx("empty")}</p>}
   <ul>{accounts.map(a=><li key={a.id}>
    <strong>{a.email||a.id}</strong><p>{tx(a.verified?"verified":"unverified")}</p>
    <button type="button" className="button button--outline" disabled={busy} onClick={()=>void run(async()=>{setConfirm("");setPreview(null);setPreview(await call({action:"preview",id:a.id}))})}>{tx("review")}</button>
   </li>)}</ul>
   {page&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>void run(()=>load(null))}>{tx("first")}</button>}
   {next&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>void run(()=>load(next))}>{tx("next")}</button>}
  </>}
  {preview&&<section className="notice-box">
   <h2>{tx("confirmTitle")}</h2><p>{preview.email}</p><p>{tx(preview.scope)}</p>
   {preview.canDelete&&preview.token?<form className="auth-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
    if(!preview.token||confirm!==preview.email)return;
    const result=await call({action:"delete",token:preview.token,email:confirm});
    if(result.state!=="deleted"||result.id!==preview.id)throw Error("unavailable");
    setAccounts(items=>items?.filter(a=>a.id!==result.id)??null);
    setPreview(null);setConfirm("");setStatus("deleted");await load(page);
   })}}>
    <label className="field-label">{tx("confirmEmail")}<input type="email" autoComplete="off" value={confirm} onChange={e=>setConfirm(e.target.value)} required/></label>
    <button className="button button--primary" disabled={busy||confirm!==preview.email}>{tx("delete")}</button>
   </form>:null}
   <button type="button" className="button button--outline" disabled={busy} onClick={()=>{setPreview(null);setConfirm("")}}>{t("common.close")}</button>
  </section>}
  {status&&<p role={status==="deleted"?"status":"alert"}>{tx(status)}</p>}
 </RegistrationFrame>;
}
