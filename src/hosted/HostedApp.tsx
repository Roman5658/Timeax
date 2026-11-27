import {SelfServiceAgencyStep} from './SelfServiceAgencyStep';
import {TeamStandalone,AccountantInvitePage,type TeamSection} from './TeamWorkflow';
import {HostedCabinetRoute} from './HostedCabinet';
import {AccountAdminPage} from './AccountAdminPage';
import {OwnerQaPage,OwnerQaLink} from './OwnerQaPage';
import {HostedLegalSheet} from "./HostedLegalSheet";
import {HostedTermsPage} from "./HostedTermsPage";
import {HostedPrivacyPage} from './HostedPrivacyPage';
import {WorkerAccountPage} from './WorkerAccountPage';
import {PayslipsPage} from './PayslipsPage';
import {FactoryTimecardsPage} from './FactoryTimecardsPage';
import {TimecardsPage} from './TimecardsPage';
import {FactoryEnrollmentPage} from './FactoryEnrollmentPage';
import {PrivateAccess} from "./PrivateAccess";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {Link,useLocation,useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {X} from "lucide-react";
import {AuthPanelContext, LegalSheetContext, type LegalDocument, RegistrationChoices, RegistrationFrame, RegistrationProgress} from "../components/PublicExperience";
import {StartPage} from "../modules/auth/pages/HostedStartPage";
import {StagingSessionPanel} from "../modules/auth/pages/StagingSessionPanel";
import {createRegistrationTransport,validateAgencyDraft,type RegistrationState} from "../modules/auth/registration/agency-registration";
import {createWorkingRegistrationClient,isCanonicalEmailOrigin,isEmailIdentityOrigin} from "../modules/auth/registration/contract/registration-client";
import {WorkerEnrollmentEntry,AgencyWorkerPanel,WorkerWorkspacePanel,EnrollmentDestinations} from './WorkerEnrollmentPage';
import {WorkspaceReadPage} from "./WorkspaceReadPage";
function AgencyStep({existing}:{existing:boolean}){
 const {t,i18n}=useTranslation(),tx=(k:string)=>t("closedHosted."+k);
 const [accessRevision,setAccessRevision]=useState(0),[revision,setRevision]=useState(0),[state,setState]=useState<RegistrationState>({state:"unavailable"}),[busy,setBusy]=useState(true);
 const [name,setName]=useState(""),[nip,setNip]=useState(""),[errors,setErrors]=useState<{name?:true;nip?:true}>({});
 const pending=useRef<AbortController|null>(null);
 const nameInput=useRef<HTMLInputElement>(null),nipInput=useRef<HTMLInputElement>(null);
 const api=useMemo(()=>createRegistrationTransport(isCanonicalEmailOrigin(location.origin)?"public-registration":"enrollment-staging",location.origin,window.fetch.bind(window)),[]);
 const loopback=isEmailIdentityOrigin(location.origin);
 const publicAuth=isEmailIdentityOrigin(location.origin);
 const publicSignup=!existing&&publicAuth;
 const auth=useMemo(()=>location.protocol==="https:"||loopback?createWorkingRegistrationClient(location.origin,window.fetch.bind(window),existing?"existing":"enrollment"):undefined,[existing,loopback]);
 const refresh=useCallback(()=>{pending.current?.abort();pending.current=null;setState({state:"unavailable"});setRevision(v=>v+1)},[]);
 useEffect(()=>{if(!auth){setBusy(false);setState({state:"unavailable"});return;}const c=new AbortController();pending.current=c;setBusy(true);
  void auth.registration(c.signal).then(v=>{if(!c.signal.aborted)setState(v)}).finally(()=>{if(pending.current===c)pending.current=null;if(!c.signal.aborted)setBusy(false)});
  return()=>{c.abort();pending.current?.abort();pending.current=null};
 },[auth,revision]);
 async function submit(){
  if(!api||pending.current||state.state!=="none")return;const check=validateAgencyDraft(name,nip);setErrors(check.errors);if(!check.draft){(check.errors.name?nameInput:nipInput).current?.focus();return;}
  const c=new AbortController();pending.current=c;setBusy(true);
  try{const result=await api.submit(check.draft,c.signal);if(!c.signal.aborted)setState(result)}
  catch{if(!c.signal.aborted)setState({state:"uncertain"})}finally{if(pending.current===c)pending.current=null;if(!c.signal.aborted)setBusy(false)}
 }
 const receipt=state.state==="pending"?state.registration:null;
 return <>
  {!existing&&<RegistrationProgress current={receipt?2:state.state==="none"?1:0} twoSteps={publicSignup}/>}
  {!loopback&&<PrivateAccess onOpened={()=>{setAccessRevision(v=>v+1);refresh()}}/>}
  <StagingSessionPanel guided simple={publicAuth} signup={publicSignup} key={(existing?"existing":"enrollment")+accessRevision} purpose={existing?"existing":"enrollment"} onChanged={refresh}/>
  {receipt?<div className="notice-box registration-receipt" role="status" data-testid="hosted-pending">{!publicAuth&&<h2>{t("stagingRegistration.pendingTitle")}</h2>}<p>{t(publicAuth?"publicSignup.saved":"stagingRegistration.pendingLead")}</p><dl><dt>{t("stagingRegistration.receiptLabel")}</dt><dd>{receipt.requestId}</dd><dt>{t("agencyRegistration.dateLabel")}</dt><dd>{new Intl.DateTimeFormat(i18n.language,{dateStyle:"medium",timeStyle:"short"}).format(new Date(receipt.requestedAt))}</dd></dl></div>:
   (!publicSignup||state.state==="none"||state.state==="uncertain")&&<div className="enrollment-details">{((!publicSignup&&(busy||state.state==="none"))||state.state==="uncertain")&&<p className="notice-box" role="status" data-testid="hosted-registration">{busy?tx("checking"):state.state==="none"?tx("ready"):state.state==="uncertain"?tx("uncertain"):t("publicExperience.closed")}</p>}
    {!existing&&state.state==="none"?<><h2 className="enrollment-subtitle">{t("publicExperience.detailsTitle")}</h2><form className="auth-form" noValidate aria-busy={busy} onSubmit={e=>{e.preventDefault();void submit()}}>
     <label className="field-label" htmlFor="agency-name"><span>{t("agencyRegistration.nameLabel")}</span><input ref={nameInput} id="agency-name" autoComplete="organization" maxLength={120} required disabled={busy} value={name} aria-invalid={!!errors.name} aria-describedby={errors.name?"agency-name-error":undefined} onChange={e=>{setName(e.target.value);setErrors(v=>({...v,name:undefined}))}}/></label>
     {errors.name&&<p id="agency-name-error" className="registration-error" role="alert">{t("agencyRegistration.nameError")}</p>}
     <label className="field-label" htmlFor="agency-nip"><span>{t("agencyRegistration.nipLabel")}</span><input ref={nipInput} id="agency-nip" inputMode="numeric" maxLength={24} disabled={busy} value={nip} aria-invalid={!!errors.nip} aria-describedby={errors.nip?"agency-nip-error":"agency-nip-hint"} onChange={e=>{setNip(e.target.value);setErrors(v=>({...v,nip:undefined}))}}/></label>
     {errors.nip&&<p id="agency-nip-error" className="registration-error" role="alert">{t("agencyRegistration.nipError")}</p>}<p id="agency-nip-hint" className="muted-copy">{t("agencyRegistration.nipHint")}</p>
     <button data-testid="hosted-submit" className="button button--primary button--full" disabled={busy||state.state!=="none"}>{t(publicSignup?"publicSignup.save":"stagingSession.submit")}</button>
    </form></>:!existing&&!publicSignup&&<p className="muted-copy">{t("publicExperience.detailsAfter")}</p>}
    {existing&&state.state==="none"&&<Link to="/register/agency">{t("existingSession.registrationLink")}</Link>}
   </div>}
  {((receipt&&!publicSignup)||state.state==="uncertain")&&<button data-testid="hosted-refresh" className="button button--outline button--full" disabled={busy} onClick={refresh}>{t("agencyRegistration.recheck")}</button>}
  {existing&&<><EnrollmentDestinations revision={revision}/><OwnerQaLink revision={revision}/><Link to="/account/recovery">{t("workerAccount.recoveryTitle")}</Link></>}
  {!publicAuth&&<details className="enrollment-disclosure"><summary>{t("publicExperience.statusDetails")}</summary><p>{tx("scope")}</p><p>{tx("noModules")}</p></details>}
  <p className="muted-copy"><Link to={existing?"/register/agency":"/login"}>{publicAuth?t(existing?"publicExperience.create":"common.login"):tx(existing?"registerTitle":"loginTitle")}</Link></p>
 </>;
}

function WorkspaceStep({organizationId}:{organizationId:string}){
 const [revision,setRevision]=useState(0),[accessRevision,setAccessRevision]=useState(0);
 return <><PrivateAccess onOpened={()=>{setAccessRevision(n=>n+1);setRevision(n=>n+1)}}/>
  <StagingSessionPanel key={accessRevision} purpose="existing" onChanged={()=>setRevision(n=>n+1)}/>
  <WorkspaceReadPage organizationId={organizationId} revision={revision}/><EnrollmentDestinations revision={revision}/></>;
}
function CanonicalAgencyStep({existing}:{existing:boolean}){
 const [selfService,setSelfService]=useState<boolean>();
 useEffect(()=>{
  const c=new AbortController();
  void fetch('/v1/session/timeax-email',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:c.signal})
   .then(async r=>r.ok&&((await r.json())?.selfService===true))
   .then(v=>{if(!c.signal.aborted)setSelfService(v)})
   .catch(()=>{if(!c.signal.aborted)setSelfService(false)});
  return()=>c.abort();
 },[]);
 if(selfService===undefined)return null;
 return selfService?<SelfServiceAgencyStep existing={existing}/>:<AgencyStep existing={existing}/>;
}
function PublicAuthPanel({pathname,closing,onClosed}:{pathname:string;closing:boolean;onClosed:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null), previous=useRef<HTMLElement|null>(null);
 const {t}=useTranslation(),navigate=useNavigate();
 const [legal,setLegal]=useState<{kind:LegalDocument;opener:HTMLAnchorElement}|null>(null);
 const openLegal=useCallback((kind:LegalDocument,opener:HTMLAnchorElement)=>setLegal({kind,opener}),[]);
 const closeLegal=useCallback(()=>setLegal(null),[]);
 const shownLegal=legal&&legal.opener.isConnected&&!closing?legal:null;
 useEffect(()=>{if(closing)setLegal(null)},[closing]);
 useEffect(()=>{
  const node=dialog.current;
  if(!node)return;
  previous.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow;
  node.showModal();
  document.body.style.overflow="hidden";
  return()=>{node.close();document.body.style.overflow=overflow;previous.current?.focus({preventScroll:true})};
 },[]);
 useEffect(()=>{
  const node=dialog.current;
  if(!node)return;
  node.scrollTop=0;
  const title=node.querySelector<HTMLElement>("#auth-book-title");
  if(title){title.tabIndex=-1;title.focus({preventScroll:true})}
 },[pathname]);
 useEffect(()=>{
  if(!closing)return;
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){onClosed();return;}
  const timeout=window.setTimeout(onClosed,460);
  return()=>window.clearTimeout(timeout);
 },[closing,onClosed]);
 const close=()=>{if(!closing)navigate("/",{replace:true})};
 const existing=pathname==="/login";
 return <dialog ref={dialog} className={`auth-book enrollment-card auth-book--centered auth-entry-sheet${closing?" is-closing":""}`} aria-labelledby="auth-book-title" onCancel={e=>{e.preventDefault();if(!shownLegal&&e.target===e.currentTarget)close()}}
  onAnimationEnd={e=>{if(closing&&e.target===e.currentTarget&&e.animationName==="auth-page-unturn")onClosed()}}
  onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
  <button type="button" className="icon-button auth-book-close" aria-label={t("common.backHome")} aria-disabled={closing} onClick={close}><X size={20}/></button>
  <div inert={closing}><AuthPanelContext.Provider value><LegalSheetContext.Provider value={openLegal}>
   {pathname==="/register"?<RegistrationChoices/>:<RegistrationFrame back={existing?"/":"/register"}
     title={t(existing?"common.login":"closedHosted.registerTitle")} lead="">
     <CanonicalAgencyStep key={pathname} existing={existing}/>
   </RegistrationFrame>}
  </LegalSheetContext.Provider></AuthPanelContext.Provider></div>
  {shownLegal&&<HostedLegalSheet kind={shownLegal.kind} opener={shownLegal.opener} onClosed={closeLegal}/>}
 </dialog>;
}
function PublicLanding({pathname}:{pathname:string}){
 const [lastPanel,setLastPanel]=useState<string|null>(()=>pathname==="/"?null:pathname);
 useLayoutEffect(()=>{if(pathname!=="/")setLastPanel(pathname)},[pathname]);
 const finishClose=useCallback(()=>setLastPanel(null),[]);
 const [footerSheet,setFooterSheet]=useState<{kind:LegalDocument;opener:HTMLAnchorElement}|null>(null);
 const openFooterSheet=useCallback((kind:LegalDocument,opener:HTMLAnchorElement)=>setFooterSheet({kind,opener}),[]);
 const closeFooterSheet=useCallback(()=>setFooterSheet(null),[]);
 useEffect(()=>{if(pathname!=="/")closeFooterSheet()},[pathname,closeFooterSheet]);
 const panel=pathname==="/"?lastPanel:pathname;
 return <>
  <LegalSheetContext.Provider value={openFooterSheet}><StartPage/></LegalSheetContext.Provider>
  {panel&&<PublicAuthPanel pathname={panel} closing={pathname==="/"} onClosed={finishClose}/>}
  {pathname==="/"&&!panel&&footerSheet&&<HostedLegalSheet centered kind={footerSheet.kind} opener={footerSheet.opener} onClosed={closeFooterSheet}/>}
 </>;
}
export function HostedApp(){
 const {t}=useTranslation(),loc=useLocation(),tx=(k:string)=>t("closedHosted."+k);
 useEffect(()=>{document.title=`Timeax — ${t("home.eyebrow")}`;},[t]);
 const teamRoute=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/(messages|schedule|templates|absence|accountants)$/);
 if(teamRoute)return <HostedCabinetRoute organizationId={teamRoute[1]} section={teamRoute[2] as TeamSection} fallback={<TeamStandalone organizationId={teamRoute[1]} section={teamRoute[2] as TeamSection}/>}/>;
 if(loc.pathname==='/accountant/invitation')return <AccountantInvitePage/>;
 const workspace=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)$/);
 const existing=loc.pathname==="/login",register=loc.pathname==="/register/agency";
 const PayslipsPageRoute=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/payslips$/);
 if(PayslipsPageRoute)return <HostedCabinetRoute key={PayslipsPageRoute[1]} organizationId={PayslipsPageRoute[1]} section="payslips" fallback={<PayslipsPage/>}/>;
 const FactoryTimecardsPageRoute=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/factory-timecards$/);
 if(FactoryTimecardsPageRoute)return <HostedCabinetRoute key={FactoryTimecardsPageRoute[1]} organizationId={FactoryTimecardsPageRoute[1]} section="factory-timecards" fallback={<FactoryTimecardsPage/>}/>;
 const TimecardsPageRoute=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/timecards$/);
 if(TimecardsPageRoute)return <HostedCabinetRoute key={TimecardsPageRoute[1]} organizationId={TimecardsPageRoute[1]} section="timecards" fallback={<TimecardsPage/>}/>;
 if(['/account','/account/settings','/account/recovery','/account/reauth'].includes(loc.pathname))return <WorkerAccountPage/>;
 if(loc.pathname==="/super-admin/accounts")return <AccountAdminPage/>;
 if(loc.pathname==="/super-admin")return <OwnerQaPage/>;
 if(loc.pathname==="/terms"||loc.pathname==="/terms/2026-11-27")return <HostedTermsPage/>;
 if(loc.pathname==="/privacy"||loc.pathname==="/privacy/")return <HostedPrivacyPage/>;
 if(["/","/register","/register/agency","/login"].includes(loc.pathname))return <PublicLanding pathname={loc.pathname}/>;
 const role=loc.pathname==="/register/worker"||loc.pathname==="/worker/join"||loc.pathname==="/worker/register"?"worker":loc.pathname==="/register/factory"||loc.pathname==="/factory/register"?"factory":null;
 const admin=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/workers$/);
 if(admin)return <HostedCabinetRoute key={admin[1]} organizationId={admin[1]} section="workers" fallback={<RegistrationFrame title={t('workerEnrollment.manage')} lead={t('workerEnrollment.adminScope')}><AgencyWorkerPanel organizationId={admin[1]}/></RegistrationFrame>}/>;
 if(workspace)return <HostedCabinetRoute key={workspace[1]} organizationId={workspace[1]} section="home" fallback={<RegistrationFrame title={t('workerEnrollment.workspace')} lead={t('workspaceRead.readOnly')}><WorkerWorkspacePanel organizationId={workspace[1]}/></RegistrationFrame>}/>;
 const setup=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/setup$/);
 if(setup)return <HostedCabinetRoute key={setup[1]} organizationId={setup[1]} section="setup" fallback={<FactoryEnrollmentPage/>}/>;
 if(role==='factory'||['/factory/review','/factory/team/join'].includes(loc.pathname)||loc.pathname==='/leader/access')return <FactoryEnrollmentPage/>;
 if(role==='worker')return <WorkerEnrollmentEntry/>;
 if(role)return <RegistrationFrame title={t("roleEntry."+role+"Title")} lead={t("publicExperience."+role+"Path")}>
  <p className="notice-box" role="status">{t("publicExperience.unavailableBody")}</p>

  <p className="muted-copy">{t("roleEntry.noGrant")}</p><Link className="button button--outline button--full" to="/login">{t("roleEntry.existingAccount")}</Link>
 </RegistrationFrame>;
 return <RegistrationFrame title={workspace?t("workspaceRead.title"):existing?tx("loginTitle"):register?tx("registerTitle"):t("publicExperience.unavailableTitle")}
  lead={workspace?tx("scope"):t("publicExperience."+(existing?"loginLead":register?"registerLead":"unavailableBody"))}>
  {workspace?<WorkspaceStep key={loc.pathname} organizationId={workspace[1]}/>:existing||register?<AgencyStep key={loc.pathname} existing={existing}/>:<Link className="button button--primary" to="/register/agency">{tx("registerTitle")}</Link>}
 </RegistrationFrame>;
}
