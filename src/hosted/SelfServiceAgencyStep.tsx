import {Eye,EyeOff} from 'lucide-react';
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {emailInvitations,enrollmentContext,workerCall,type Membership} from './worker-enrollment';
import {workerRegistrationCopy} from './worker-registration-copy';
import {useTranslation} from 'react-i18next';
import {LegalLink,RegistrationProgress} from '../components/PublicExperience';
import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';
import {createWorkingRegistrationClient,validEmail} from '../modules/auth/registration/contract/registration-client';

const organizationId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const setup='/api/timeax/agency/setup';
const termsVersion='2026-11-27';
async function call(path:string,signal:AbortSignal,body?:object){
 const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',redirect:'error',
  signal,headers:body?{'Content-Type':'application/json',Accept:'application/json'}:{Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('unavailable');
 const v=await response.json();
 if(!response.ok)throw Error(typeof v.error==='string'?v.error:'unavailable');
 return v;
}
type Stage='check'|'code'|'password'|'details'|'resume'|'unavailable'|'destinations';
const errors=['invalid-credentials','invalid-nip','invalid-name','invalid-password','terms-required','try-later','password-not-set','registration-required','service-unavailable'];

export function SelfServiceAgencyStep({existing}:{existing:boolean}){
 const {t,i18n}=useTranslation(),copy=workerRegistrationCopy(i18n.resolvedLanguage),navigate=useNavigate(),loc=useLocation();
 const returnTo=typeof loc.state?.returnTo==='string'?loc.state.returnTo:'';
 const workerPasswordReauth=existing&&loc.state?.workerPasswordReauth===true;
 const preferEmailCode=existing&&new URLSearchParams(loc.search).get('method')==='code';
 const client=useMemo(()=>createWorkingRegistrationClient(location.origin,fetch.bind(window),existing?'existing':'enrollment'),[existing]);
 const [stage,setStage]=useState<Stage>('check'),[needsPassword,setNeedsPassword]=useState(true),[email,setEmail]=useState(''),[name,setName]=useState(''),[nip,setNip]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [workerReady,setWorkerReady]=useState(false);
 const [productionDestinations,setProductionDestinations]=useState<Membership[]>([]);
 const [termsAccepted,setTermsAccepted]=useState(false),[showPassword,setShowPassword]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const accept=useCallback((v:{state?:unknown;organizationId?:unknown;passwordRequired?:unknown},reopening=false)=>{
  if(v?.state==='ready'&&organizationId(v.organizationId)){
   const home='/workspace/'+v.organizationId;
   navigate([home+'/workers',home+'/workers?tab=applications'].includes(returnTo)?returnTo:home,{replace:true});return;
  }
  if(v?.state==='details-required'){
   setNeedsPassword(v.passwordRequired===true);setStage(reopening?'resume':'details');return;
  }
  throw Error('service-unavailable');
 },[navigate,returnTo]);
 const destinations=useCallback(async(signal:AbortSignal,onlyKnown=false)=>{
  const scope=await client.context(signal);
  if(signal.aborted)return;
  if(scope?.workerSelfService){
   setWorkerReady(true);
   try{const memberships=enrollmentContext(await workerCall('context',undefined,signal)).memberships;
    const member=memberships.find(m=>m.role==='worker'&&m.kind==='agency');
    const productions=memberships.filter(m=>m.kind==='factory'&&['factory_admin','team_leader','worker'].includes(m.role));
    if(signal.aborted)return;
    if(workerPasswordReauth&&memberships.length&&memberships.every(m=>m.role==='worker')){navigate('/account/settings',{replace:true});return;}
    if(member&&scope.workerProvisioning){
     try{
      if(emailInvitations(await workerCall('email-invitations',undefined,signal)).length){
       if(!signal.aborted)navigate('/register/worker',{replace:true});return;
      }
     }catch{}
    }
    if(signal.aborted)return;
    if(!member&&productions.length===1){navigate('/workspace/'+productions[0].organizationId,{replace:true});return;}
    if(productions.length>0){setProductionDestinations(memberships.filter(m=>m===member||productions.includes(m)));setStage('destinations');return;}
    if(onlyKnown&&!member){setStage('password');return;}
    navigate(member?'/workspace/'+member.organizationId:'/register/worker',{replace:true,...(!member?{state:{fromWorkerLogin:true}}:{})});
    return;
   }catch{if(signal.aborted)return}
  }
  setStage('destinations');
 },[client,navigate,workerPasswordReauth]);
 const refresh=useCallback(async(reopening=false)=>{
  if(controller.current)return;
  const c=new AbortController();controller.current=c;
  try{
   const context=await client.context(c.signal);
   if(c.signal.aborted)return;
   if(!context){setStage('unavailable');return;}
   setWorkerReady(context.workerSelfService===true);
   if(context.state!=='verified'){setStage(old=>old==='code'||workerPasswordReauth||preferEmailCode?'code':existing?'password':'code');return;}
   if(existing){
    try{const state=await call(setup,c.signal);if(c.signal.aborted)return;
     if(state?.state==='ready'){accept(state);return;}
    }catch(e){if(c.signal.aborted)return;if(!(e instanceof Error&&e.message==='registration-required'))throw e;}
    // A verified email or an agency draft is not a request to resume registration.
    await destinations(c.signal,reopening);return;
   }
   const state=await call(setup,c.signal);
   if(!c.signal.aborted)accept(state,reopening);
  }catch(e){if(!c.signal.aborted){setError(e instanceof Error?e.message:'unavailable');setStage('unavailable');}}
  finally{if(controller.current===c)controller.current=null;}
 },[accept,client,destinations,existing,preferEmailCode,workerPasswordReauth]);
 useEffect(()=>{void refresh(true);return()=>{controller.current?.abort();controller.current=null;}},[refresh]);
 async function submit(e:FormEvent){
  e.preventDefault();
  if(controller.current||busy||!['password','details'].includes(stage))return;
  if(stage==='password'&&!validEmail(email.trim()))return;
  if(stage==='details'&&!termsAccepted){setError('terms-required');return;}
  const c=new AbortController();controller.current=c;setBusy(true);setError('');
  try{
   const path=stage==='password'?'/api/timeax/auth/public/password':setup;
   const body=stage==='password'?{email:email.trim(),password}:{agencyName:name,nip,termsVersion,...(needsPassword?{password}:{})};
   const result=await call(path,c.signal,body);
   if(c.signal.aborted)return;
   if(stage==='password'&&result?.state==='details-required')await destinations(c.signal);
   else accept(result);
  }catch(e){
   if(!c.signal.aborted){
    const key=e instanceof Error?e.message:'unavailable';
    setError(key);
    if(stage==='details'&&!['invalid-name','invalid-nip','invalid-password','terms-required'].includes(key)){
     try{accept(await call(setup,c.signal))}catch{}
    }
   }
  }
  finally{
   if(!c.signal.aborted){setBusy(false);setPassword('');setShowPassword(false)}
   if(controller.current===c)controller.current=null;
  }
 }
 async function switchToCode(){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;setBusy(true);setError('');
  try{
   const scope=await client.context(c.signal);
   if(!scope||scope.state==='verified'&&!await client.logout(c.signal))throw Error('service-unavailable');
   if(!c.signal.aborted){setStage('code');setPassword('');}
  }catch{if(!c.signal.aborted)setError('service-unavailable');}
  finally{if(controller.current===c){controller.current=null;setBusy(false);}}
 }
 async function restartRegistration(){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;setBusy(true);
  try{
   const context=await client.context(c.signal);
   if(!context||context.state==='verified'&&!await client.logout(c.signal))throw Error('service-unavailable');
   if(c.signal.aborted)return;
   setEmail('');setPassword('');setShowPassword(false);setName('');setNip('');setTermsAccepted(false);
   navigate('/register/agency',{replace:true});
   setError('');setStage('code');
  }catch{if(!c.signal.aborted)setError('service-unavailable');}
  finally{if(controller.current===c){controller.current=null;setBusy(false);}}
 }
 const termsHref='/terms/'+termsVersion;
 return <>
  {!existing&&<RegistrationProgress twoSteps current={stage==='details'||stage==='resume'?1:0}/>}
  {stage==='check'&&<p role="status">{t('closedHosted.checking')}</p>}
  {!existing&&stage==='resume'&&<div className="auth-form">
   <p role="status">{t('publicSignup.unfinishedAgency')}</p>
   <button type="button" className="button button--primary button--full" disabled={busy} onClick={()=>{setError('');setStage('details')}}>{t('publicSignup.continueAgency')}</button>
   <button type="button" className="button button--outline button--full" disabled={busy} onClick={()=>void restartRegistration()}>{t('publicSignup.restartAgency')}</button>
  </div>}
  {stage==='code'&&<StagingSessionPanel guided simple signup={!existing} termsHref={existing?undefined:termsHref} purpose={existing?'existing':'enrollment'} onChanged={()=>void refresh()}/>}
   {existing&&stage==='destinations'&&<div className="auth-form">{productionDestinations.length>0?productionDestinations.map(m=><Link key={m.membershipId} to={'/workspace/'+m.organizationId}>{m.name} · {t('workspaceRead.'+m.role)}</Link>):<><p role="status">{copy.noWorkspace}</p>
    {workerReady&&<Link to="/register/worker">{copy.workerRoute}</Link>}
    <Link to="/register/agency">{copy.agencyRoute}</Link>
    </>}</div>}
  {stage==='unavailable'&&(error==='registration-required'?
   <button type="button" className="button button--primary" disabled={busy} onClick={()=>void restartRegistration()}>{t('publicExperience.create')}</button>:
   <button type="button" className="button button--outline" onClick={()=>void refresh(true)}>{t('publicSignup.retry')}</button>)}
  {(stage==='password'||stage==='details')&&<form className="auth-form" onSubmit={submit} aria-busy={busy}>
   {stage==='password'&&<label className="field-label">{t('stagingSession.email')}<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy} required maxLength={254}/></label>}
   {(stage==='password'||needsPassword)&&<div className="field-label">
    <label htmlFor="agency-password">{t('selfService.password')}</label>
    <div className="public-password-field">
     <input id="agency-password" type={stage==='details'&&showPassword?'text':'password'} autoComplete={stage==='password'?'current-password':'new-password'} minLength={stage==='details'?12:undefined} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} required/>
     {stage==='details'&&<button type="button" className="icon-button public-password-toggle" aria-controls="agency-password"
      aria-label={t(showPassword?'publicSignup.hidePassword':'publicSignup.showPassword')} disabled={busy} onClick={()=>setShowPassword(v=>!v)}>
      {showPassword?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}
     </button>}
    </div>
   </div>}
   {stage==='details'&&<>
    <label className="field-label">{t('agencyRegistration.nameLabel')}<input autoComplete="organization" value={name} onChange={e=>setName(e.target.value)} disabled={busy} required minLength={2} maxLength={120}/></label>
    <label className="field-label">{t('publicSignup.requiredNip')}<input inputMode="numeric" value={nip} onChange={e=>setNip(e.target.value)} disabled={busy} maxLength={24} required aria-describedby="agency-nip-lookup"/></label>
    <p id="agency-nip-lookup" className="muted-copy">{t('publicSignup.agencyNipLookup')}</p>
    <div className="public-legal-links">
     <LegalLink kind="terms" to={termsHref}/>
     <LegalLink kind="privacy" to="/privacy#privacy-access"/>
    </div>
    <label className="public-agreement"><input type="checkbox" required checked={termsAccepted} disabled={busy} onChange={e=>setTermsAccepted(e.target.checked)}/>{t('hostedLegal.accept')}</label>
   </>}
   <button className="button button--primary button--full" disabled={busy}>{t(stage==='password'?'common.login':'selfService.open')}</button>
  </form>}
  {error&&<p role="alert" className="registration-error">{t('selfService.'+(errors.includes(error)?error:'service-unavailable'))}</p>}
  {existing&&stage==='password'&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>void switchToCode()}>{copy.otpLogin}</button>}
  {existing&&stage==='code'&&<button type="button" className="button button--outline" onClick={()=>{setStage('password');setError('')}}>{copy.passwordLogin}</button>}
  {existing&&stage!=='destinations'&&<p><Link to="/register">{t('publicExperience.create')}</Link></p>}
  {!existing&&stage!=='details'&&<p><Link to="/login">{t('common.login')}</Link></p>}
 </>;
}
