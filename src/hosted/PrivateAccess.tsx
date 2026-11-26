import {useEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
export function PrivateAccess({onOpened}:{onOpened:()=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t("closedHosted."+k);
 const read=()=>new URLSearchParams(location.hash.slice(1)).get("permit");
 const [permit,setPermit]=useState(read),[busy,setBusy]=useState(false),[state,setState]=useState("privateHint");
 const op=useRef<AbortController|null>(null);
 useEffect(()=>{
  const reopen=()=>{setPermit(read());setState("privateHint");history.replaceState(history.state,"",location.pathname)};
  history.replaceState(history.state,"",location.pathname);window.addEventListener("hashchange",reopen);
  return()=>{window.removeEventListener("hashchange",reopen);op.current?.abort()};
 },[]);
 async function open(){
  if(location.protocol!=="https:"||!permit||permit.length>8192||op.current)return;const c=new AbortController();op.current=c;setBusy(true);
  try{const r=await fetch("/api/timeax/access/open",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",signal:c.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({permit})});
   const v=await r.json();if(!r.ok||v.state!=="private-access-open"||!Array.isArray(v.grants)||v.grants.length)throw Error();
   if(!c.signal.aborted){setState("privateOpened");setPermit(null);onOpened()}
  }catch{if(!c.signal.aborted)setState("closed")}finally{if(op.current===c)op.current=null;if(!c.signal.aborted)setBusy(false)}
 }
 if(!permit&&state!=="privateOpened")return null;
 return <section aria-label={tx("privateTitle")}><p role="status" data-testid="hosted-access">{tx(state)}</p>{permit&&<button data-testid="hosted-open" className="button button--outline button--full" disabled={busy||location.protocol!=="https:"} onClick={()=>void open()}>{tx("privateOpen")}</button>}</section>;
}
