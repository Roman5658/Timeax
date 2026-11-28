import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {RegistrationFrame,LegalLink} from '../components/PublicExperience';
import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';
import {createWorkingRegistrationClient,type AccessContext} from '../modules/auth/registration/contract/registration-client';
import {emailInvitations,enrollmentContext,workerCall,type EmailInvitation,type EnrollmentContext} from './worker-enrollment';
import {workerProvisionCopy} from './worker-provisioning-copy';
import {WorkerTermsGate} from './WorkerTermsGate';
import {ApplicationNameFields} from './ApplicationNameFields';
import {workerRegistrationCopy} from './worker-registration-copy';

const membershipId=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
type FoundAgency={agency_id:string;name:string;nip:string;verified?:boolean};
const invitePaths=new Set(['/register/worker','/worker/join','/worker/register']);
function invitation(raw:string){
 const source=raw.trim();
 if(/^[a-f0-9]{64}$/i.test(source))return source.toLowerCase();
 try{
  const url=new URL(source);
  if(!['https://timeax.pl','https://www.timeax.pl'].includes(url.origin)||url.username||url.password||!invitePaths.has(url.pathname))return '';
  const code=new URLSearchParams(url.hash.slice(1)).get('invite')??url.searchParams.get('invite')??url.searchParams.get('invitation');
  return code&&/^[a-f0-9]{64}$/i.test(code)?code.toLowerCase():'';
 }catch{return ''}
}
function normalizeNip(raw:string){
 const nip=raw.replace(/[\s-]/g,'');
 return /^\d{10}$/.test(nip)&&! /^(\d)\1{9}$/.test(nip)&&[6,5,7,2,3,4,5,6,7].reduce((s,w,i)=>s+w*Number(nip[i]),0)%11===Number(nip[9])?nip:'';
}

export function PublicWorkerEntry(){
 const {t,i18n}=useTranslation(),copy=workerRegistrationCopy(i18n.resolvedLanguage),loc=useLocation();
 const fromLogin=loc.state?.fromWorkerLogin===true;
 const [initialInvite]=useState(()=>invitation(new URLSearchParams(loc.hash.slice(1)).get('invite')??new URLSearchParams(loc.search).get('invite')??new URLSearchParams(loc.search).get('invitation')??''));
 const client=useMemo(()=>createWorkingRegistrationClient(location.origin,fetch.bind(window),'enrollment'),[]);
 const [purpose,setPurpose]=useState<'enrollment'|'existing'>('enrollment');
 const [scope,S]=useState<AccessContext>(),[checking,C]=useState(true),[revision,R]=useState(0);
 useEffect(()=>{
  const c=new AbortController();C(true);
  void client.context(c.signal).then(next=>{if(!c.signal.aborted)S(next)}).finally(()=>{if(!c.signal.aborted)C(false)});
  return()=>c.abort();
 },[client,revision]);
 useEffect(()=>{
  const url=new URL(location.href);const q=url.searchParams;
  const secret=new URLSearchParams(url.hash.slice(1)).has('invite')||q.has('invite')||q.has('invitation');
  if(secret){q.delete('invite');q.delete('invitation');history.replaceState(history.state,'',url.pathname+url.search)}
 },[]);
 const confirmed=scope?.state==='verified',ready=scope?.workerSelfService===true;
 return <RegistrationFrame title={copy.title} lead={copy.lead}>
  <ol className="enrollment-progress"><li aria-current={!confirmed?'step':undefined} className={confirmed?'complete':undefined}>{copy.account}</li><li aria-current={confirmed?'step':undefined}>{copy.connect}</li></ol>
  {!scope&&checking?<p role="status">{t('closedHosted.checking')}</p>:!ready?
   <div role="status" className="notice-box"><p>{copy.unavailable}</p><button className="button button--outline" type="button" onClick={()=>R(n=>n+1)}>{copy.retry}</button></div>:
   confirmed?<WorkerTermsGate onSessionExpired={()=>R(n=>n+1)}><WorkerAgencyConnection provisioning={scope?.workerProvisioning===true} initialInvite={initialInvite} autoConnect={fromLogin&&!initialInvite} onSessionExpired={()=>R(n=>n+1)}/></WorkerTermsGate>
   :<>
    <div className="form-actions">
     <button className={'button '+(purpose==='enrollment'?'button--primary':'button--outline')} type="button" aria-pressed={purpose==='enrollment'} onClick={()=>setPurpose('enrollment')}>{copy.newAccount}</button>
     <button className={'button '+(purpose==='existing'?'button--primary':'button--outline')} type="button" aria-pressed={purpose==='existing'} onClick={()=>setPurpose('existing')}>{copy.existingAccount}</button>
    </div>
    <p className="muted-copy">{copy.otpLead} <LegalLink kind="terms" to="/terms/2026-11-27"/></p>
    <StagingSessionPanel key={purpose} purpose={purpose} guided simple signup={purpose==='enrollment'} onChanged={()=>R(n=>n+1)}/>
    <p><Link to="/login">{copy.loginRoute}</Link></p>
   </>}
 </RegistrationFrame>;
}

function WorkerAgencyConnection({initialInvite,onSessionExpired,provisioning,autoConnect}:{initialInvite:string;onSessionExpired:()=>void;provisioning:boolean;autoConnect:boolean}){
 const {t,i18n}=useTranslation(),copy=workerRegistrationCopy(i18n.resolvedLanguage),inviteCopy=workerProvisionCopy(i18n.resolvedLanguage),navigate=useNavigate();
 const [invitations,Inv]=useState<EmailInvitation[]>([]),[invitationError,InviteError]=useState(false);
 const [method,M]=useState<'nip'|'invite'>(initialInvite?'invite':'nip'),[nip,N]=useState(''),[code,I]=useState(initialInvite);
 const [value,V]=useState<EnrollmentContext>(),[agency,A]=useState<FoundAgency|null>(),[notice,T]=useState(''),[err,E]=useState('');
 const [busy,B]=useState(false),[revision,R]=useState(0),pending=useRef(false),autoAttempted=useRef(false);
 const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState('');
 const names=<ApplicationNameFields first={firstName} last={lastName} onFirst={setFirstName} onLast={setLastName} disabled={busy}/>;
 const expired=useRef(onSessionExpired);expired.current=onSessionExpired;
 useEffect(()=>{
  const c=new AbortController();
  void workerCall('context',undefined,c.signal).then(enrollmentContext).then(v=>{if(!c.signal.aborted)V(v)})
   .catch(e=>{if(!c.signal.aborted){if(e?.message==='login')expired.current();else E(copy.unavailable)}});
  return()=>c.abort();
 },[revision,copy.unavailable]);
 useEffect(()=>{
  if(!provisioning)return;
  const c=new AbortController();InviteError(false);
  void workerCall('email-invitations',undefined,c.signal).then(emailInvitations).then(v=>{if(!c.signal.aborted)Inv(v)})
   .catch(e=>{if(!c.signal.aborted&&e?.message!=='denied')InviteError(true)});
  return()=>c.abort();
 },[revision,provisioning]);
 const acceptInvite=useCallback(async(invite:EmailInvitation)=>{
  if(pending.current)return;pending.current=true;B(true);E('');T('');InviteError(false);
  try{
   const res=await workerCall('accept-email-invitation',{invitationId:invite.id}) as {state?:string;organizationId?:string};
   if(res?.state!=='connected'||res.organizationId!==invite.organizationId)throw Error('unavailable');
   navigate('/workspace/'+invite.organizationId,{replace:true,state:{offerWorkerPassword:true}});
  }catch(e){if(e instanceof Error&&e.message==='login')expired.current();else E(inviteCopy.inviteError)}
  finally{pending.current=false;B(false)}
 },[inviteCopy.inviteError,navigate]);
 useEffect(()=>{
  if(!autoConnect||autoAttempted.current||pending.current||!value||value.memberships.length!==0||invitations.length!==1)return;
  autoAttempted.current=true;
  void acceptInvite(invitations[0]);
 },[autoConnect,value,invitations,acceptInvite]);
 const normalized=normalizeNip(nip);
 async function run(task:()=>Promise<void>,errorMessage:string=copy.cannotApply){
  if(pending.current)return;pending.current=true;B(true);E('');T('');
  try{await task()}catch(e){if(e instanceof Error&&e.message==='login')expired.current();else E(errorMessage)}
  finally{pending.current=false;B(false)}
 }
 function search(e:FormEvent){
  e.preventDefault();
  if(!normalized){E(copy.invalidNip);return}
  void run(async()=>{
   A(undefined);
   const result=await workerCall('lookup',{nip:normalized}) as {agency?:FoundAgency|null};
   if(result?.agency!==null&&(!membershipId(result?.agency?.agency_id)||typeof result.agency?.name!=='string'||result.agency.nip!==normalized))throw Error('unavailable');
   A(result.agency);
  },inviteCopy.searchError);
 }
 function apply(kind:'request'|'claim'){
  const body=kind==='request'&&agency?.nip===normalized?{agencyId:agency.agency_id,nip:normalized}:kind==='claim'&&invitation(code)?{code:invitation(code)}:null;
  if(!body){E(kind==='request'?copy.invalidNip:copy.invalidInvite);return}
  void run(async()=>{
   const result=await workerCall(kind,{...body,firstName:firstName.trim(),lastName:lastName.trim()}) as {application?:{application_id?:string;status?:string}};
   if(!membershipId(result?.application?.application_id))throw Error('unavailable');
   if(result.application?.status==='pending'){
    navigate('/account',{replace:true,state:{pendingWorkerApplication:result.application.application_id}});return;
   }
   A(undefined);if(kind==='claim')I('');T(result.application?.status==='approved'?copy.approved:copy.applied);R(n=>n+1);
  });
 }
 const workers=value?.memberships.filter(m=>m.role==='worker')??[];
 if(value?.memberships.some(m=>m.role==='agency_admin')&&!workers.length&&!invitations.length)return <p role="status" className="notice-box">{copy.agencySignedIn}</p>;
 return <section aria-label={copy.connect} aria-busy={busy}>
  <p role="status">{copy.verified}</p>
  {value&&!workers.length&&<p><Link className="button button--outline" to="/account">{t('workerAccount.title')}</Link></p>}
  {invitations.length>0&&<section aria-label={inviteCopy.invitations}><h2>{inviteCopy.invitations}</h2>
   {invitations.map(invite=><article className="notice-box" key={invite.id}><strong>{invite.name}</strong>
    <p><button type="button" className="button button--primary" disabled={busy} onClick={()=>void acceptInvite(invite)}>{inviteCopy.accept}</button></p>
   </article>)}
  </section>}
  {invitationError&&<p role="status">{inviteCopy.unavailable} <button type="button" className="button button--outline" onClick={()=>R(n=>n+1)}>{copy.retry}</button></p>}
  {value?.applications.map(a=>{
   const current=workers.some(m=>m.organizationId===a.organizationId);
   return <article className="notice-box" key={a.id}><strong>{a.name}</strong><p>{a.status==='pending'?copy.pending:current?copy.approved:copy.accessEnded}</p></article>;
  })}
  {workers.map(m=><p key={m.membershipId}><Link className="button button--primary" to={'/workspace/'+m.organizationId}
   >{copy.workspace}: {m.name}</Link></p>)}
  {value?.applications.some(a=>a.status==='pending')&&<button className="button button--outline" type="button" disabled={busy} onClick={()=>{E('');R(n=>n+1)}}>{copy.checkApplication}</button>}
  <div className="form-actions">
   <button className={'button '+(method==='nip'?'button--primary':'button--outline')} type="button" aria-pressed={method==='nip'} disabled={busy} onClick={()=>{M('nip');E('');T('')}}>{copy.nipMethod}</button>
   <button className={'button '+(method==='invite'?'button--primary':'button--outline')} type="button" aria-pressed={method==='invite'} disabled={busy} onClick={()=>{M('invite');E('');T('')}}>{copy.invitationMethod}</button>
  </div>
  <div key={method} className="agency-production-leaf">
   {method==='nip'?<>
    <p id="worker-nip-help" className="muted-copy">{copy.nipHelp}</p>
    <form className="auth-form" onSubmit={search}>
     <label className="field-label" htmlFor="worker-nip-connection"><span>{copy.nipLabel}</span><input id="worker-nip-connection" aria-describedby="worker-nip-help" inputMode="numeric" autoComplete="off" required maxLength={24} value={nip} disabled={busy} onChange={e=>{N(e.target.value);A(undefined);E('');T('')}}/></label>
     <button className="button button--primary" disabled={busy||!value}>{copy.search}</button>
    </form>
    {agency===null&&<p role="status">{copy.notFound}</p>}
    {agency&&<article className="notice-box"><strong>{agency.name}</strong><p>NIP: {agency.nip}</p>{agency.verified===false&&<p>{inviteCopy.unverified}</p>}
      <form className="auth-form" onSubmit={e=>{e.preventDefault();apply('request')}}>{names}
       <button type="submit" className="button button--primary" disabled={busy||!value||!firstName.trim()||!lastName.trim()}>{copy.apply}</button></form></article>}
   </>:<><p id="worker-invite-help" className="muted-copy">{copy.inviteHelp}</p>
    <form className="auth-form" onSubmit={e=>{e.preventDefault();apply('claim')}}>
     <label className="field-label" htmlFor="worker-invite-connection"><span>{copy.inviteLabel}</span><input id="worker-invite-connection" aria-describedby="worker-invite-help" autoComplete="off" spellCheck={false} required maxLength={300} value={code} disabled={busy} onChange={e=>{I(e.target.value);E('');T('')}}/></label>
     {names}
     <button className="button button--primary" disabled={busy||!value||!firstName.trim()||!lastName.trim()}>{copy.inviteAction}</button>
    </form>
   </>}
  </div>
  {notice&&<p role="status">{notice}</p>}
  {err&&<p role="alert" className="registration-error">{err}</p>}
  {!value&&err&&<button className="button button--outline" type="button" disabled={busy} onClick={()=>{E('');R(n=>n+1)}}>{copy.retry}</button>}
 </section>;
}
