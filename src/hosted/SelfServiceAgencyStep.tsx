import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Link,useNavigate} from 'react-router-dom';
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
type Stage='check'|'code'|'password'|'details'|'unavailable';
const errors=['invalid-credentials','invalid-nip','invalid-name','invalid-password','terms-required','try-later','password-not-set','registration-required','service-unavailable'];

export function SelfServiceAgencyStep({existing}:{existing:boolean}){
 const {t}=useTranslation(),navigate=useNavigate();
 const client=useMemo(()=>createWorkingRegistrationClient(location.origin,fetch.bind(window),existing?'existing':'enrollment'),[existing]);
 const [stage,setStage]=useState<Stage>('check'),[needsPassword,setNeedsPassword]=useState(true),[email,setEmail]=useState(''),[name,setName]=useState(''),[nip,setNip]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [termsAccepted,setTermsAccepted]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const accept=useCallback((v:{state?:unknown;organizationId?:unknown;passwordRequired?:unknown})=>{
  if(v?.state==='ready'&&organizationId(v.organizationId)){navigate('/workspace/'+v.organizationId,{replace:true});return;}
  if(v?.state==='details-required'){
   setNeedsPassword(v.passwordRequired===true);setStage('details');return;
  }
  throw Error('service-unavailable');
 },[navigate]);
 const refresh=useCallback(async()=>{
  if(controller.current)return;
  const c=new AbortController();controller.current=c;
  try{
   const context=await client.context(c.signal);
   if(c.signal.aborted)return;
   if(!context){setStage('unavailable');return;}
   if(context.state!=='verified'){setStage(old=>old==='code'?'code':existing?'password':'code');return;}
   accept(await call(setup,c.signal));
  }catch(e){if(!c.signal.aborted){setError(e instanceof Error?e.message:'unavailable');setStage('unavailable');}}
  finally{if(controller.current===c)controller.current=null;}
 },[accept,client,existing]);
 useEffect(()=>{void refresh();return()=>{controller.current?.abort();controller.current=null;}},[refresh]);
 async function submit(e:FormEvent){
  e.preventDefault();
  if(controller.current||busy||!['password','details'].includes(stage))return;
  if(stage==='password'&&!validEmail(email.trim()))return;
  if(stage==='details'&&!termsAccepted){setError('terms-required');return;}
  const c=new AbortController();controller.current=c;setBusy(true);setError('');
  try{
   const path=stage==='password'?'/api/timeax/auth/public/password':setup;
   const body=stage==='password'?{email:email.trim(),password}:{agencyName:name,nip,termsVersion,...(needsPassword?{password}:{})};
   accept(await call(path,c.signal,body));
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
   if(!c.signal.aborted){setBusy(false);setPassword('')}
   if(controller.current===c)controller.current=null;
  }
 }
 async function restartRegistration(){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;setBusy(true);
  try{
   if(!await client.logout(c.signal))throw Error('service-unavailable');
   navigate('/register/agency',{replace:true});
   setError('');setStage('code');
  }catch{if(!c.signal.aborted)setError('service-unavailable');}
  finally{if(controller.current===c){controller.current=null;setBusy(false);}}
 }
 const termsHref='/terms/'+termsVersion;
 return <>
  {!existing&&<RegistrationProgress twoSteps current={stage==='details'?1:0}/>}
  {stage==='check'&&<p role="status">{t('closedHosted.checking')}</p>}
  {stage==='code'&&<StagingSessionPanel guided simple signup={!existing} termsHref={existing?undefined:termsHref} purpose={existing?'existing':'enrollment'} onChanged={()=>void refresh()}/>}
  {stage==='unavailable'&&(error==='registration-required'?
   <button type="button" className="button button--primary" disabled={busy} onClick={()=>void restartRegistration()}>{t('publicExperience.create')}</button>:
   <button type="button" className="button button--outline" onClick={()=>void refresh()}>{t('publicSignup.retry')}</button>)}
  {(stage==='password'||stage==='details')&&<form className="auth-form" onSubmit={submit} aria-busy={busy}>
   {stage==='password'&&<label className="field-label">{t('stagingSession.email')}<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy} required maxLength={254}/></label>}
   {(stage==='password'||needsPassword)&&<label className="field-label">{t('selfService.password')}<input type="password" autoComplete={stage==='password'?'current-password':'new-password'} minLength={stage==='details'?12:undefined} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} required/></label>}
   {stage==='details'&&<>
    <label className="field-label">{t('agencyRegistration.nameLabel')}<input autoComplete="organization" value={name} onChange={e=>setName(e.target.value)} disabled={busy} required minLength={2} maxLength={120}/></label>
    <label className="field-label">{t('agencyRegistration.nipLabel')}<input inputMode="numeric" value={nip} onChange={e=>setNip(e.target.value)} disabled={busy} maxLength={24}/></label>
    <div className="public-legal-links">
     <LegalLink kind="terms" to={termsHref}/>
     <LegalLink kind="privacy" to="/privacy#privacy-access"/>
    </div>
    <label className="public-agreement"><input type="checkbox" required checked={termsAccepted} disabled={busy} onChange={e=>setTermsAccepted(e.target.checked)}/>{t('hostedLegal.accept')}</label>
   </>}
   <button className="button button--primary button--full" disabled={busy}>{t(stage==='password'?'common.login':'selfService.open')}</button>
  </form>}
  {error&&<p role="alert" className="registration-error">{t('selfService.'+(errors.includes(error)?error:'service-unavailable'))}</p>}
  {existing&&stage==='password'&&<button type="button" className="button button--outline" onClick={()=>{setStage('code');setPassword('');setError('')}}>{t('existingSession.title')}</button>}
  {existing&&stage!=='details'&&<p><Link to="/register/agency">{t('publicExperience.create')}</Link></p>}
  {!existing&&stage!=='details'&&<p><Link to="/login">{t('common.login')}</Link></p>}
 </>;
}
