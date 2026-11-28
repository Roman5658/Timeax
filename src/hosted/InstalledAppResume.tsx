import {loadHostedCabinetModule} from "./load-hosted-cabinet";
import {HostedLoading} from "./HostedLoading";
import {useEffect,useState,type ReactNode} from "react";
import {useLocation,useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import brandLogo from "../components/timeax-brand.webp";
import {checkInstalledLaunch,installedLaunch} from "./pwa-launch";

const launchTimeoutMs=8_000;
function isStandalone(){
 // Safari's install mode is also exposed by navigator.standalone on iOS.
 return window.matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
}

/** Only initial Home Screen launches (including older shortcuts) resume here.
 * Password reauthentication, invitation and workspace deep links stay on their own routes. */
export function InstalledAppResume({children}:{children:ReactNode}){
 const location=useLocation(),navigate=useNavigate(),{t}=useTranslation();
 const [fromHomeIcon,setFromHomeIcon]=useState(()=>installedLaunch(location,window.location.origin,isStandalone())==="home-icon");
 const launch=installedLaunch(location,window.location.origin,fromHomeIcon);
 const [attempt,setAttempt]=useState(0),[unavailable,setUnavailable]=useState(false);
 useEffect(()=>{
  if(!launch){setUnavailable(false);return;}
  // Download code while resolving the session; do not read or expose workspace data here.
  void loadHostedCabinetModule().catch(()=>{});
  const controller=new AbortController();
  const timer=window.setTimeout(()=>{setUnavailable(true);controller.abort();},launchTimeoutMs);
  void checkInstalledLaunch(window.location.origin,window.fetch.bind(window),controller.signal,launch).then(result=>{
   if(controller.signal.aborted)return;
   window.clearTimeout(timer);
   if(result.state==="unavailable"){setUnavailable(true);return;}
   setFromHomeIcon(false);
   if(result.state==="workspace"){
    // The workspace still verifies current access before showing any private data.
    navigate(result.path,{replace:true});
   }else if(result.state==="login"){
    // This existing route checks the session again and resolves an allowed workspace.
    navigate(result.path,{replace:true});
   }else if(launch==="app")navigate("/",{replace:true});
  });
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[attempt,launch,navigate]);
 // A route change during verification cancels this launch, even if later returning to '/'.
 useEffect(()=>{if(location.pathname!=="/"||location.search||location.hash)setFromHomeIcon(false);},[location.pathname,location.search,location.hash]);
 if(!launch)return children;
 if(!unavailable)return <HostedLoading/>;
 return <main className="auth-page">
  <div className="auth-main"><section className="auth-card" aria-label="Timeax">
   <img className="brand-mark-image" src={brandLogo} alt="Timeax" />
   <><p role="status">{t("auth.sessionUnavailable")}</p><div className="auth-form">
        <button className="button button--primary" type="button" onClick={()=>{setUnavailable(false);setAttempt(value=>value+1);}}>{t("auth.tryAgain")}</button>
        <button className="button button--outline" type="button" onClick={()=>{setUnavailable(false);setFromHomeIcon(false);navigate("/",{replace:true});}}>{t("common.backHome")}</button>
       </div></>

  </section></div>
 </main>;
}
