import {PayslipAmounts} from './PayslipAmounts';
import {PayslipPdfButton} from './PayslipPdfButton';
import {useMemberNames} from './MemberNames';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';import {PrivateAccess} from './PrivateAccess';
import {WorkerPasswordPanel} from './WorkerPasswordPanel';
import {ApplicationNameFields} from './ApplicationNameFields';
import {workerCall} from './worker-enrollment';
import {PASSWORD_RESET_PATH,passwordResetHeading} from './PasswordResetForm';
import {hasCurrentWorkerWorkspace,shouldOfferAgencyJoin,workerWorkspaceHint,workerWorkspaceReturn} from './worker-account-navigation';
import {useWorkerEnrollmentStatus} from './use-worker-connections';
import {persistApprovedWorkerSession} from './worker-session';
import {workerRegistrationCopy} from './worker-registration-copy';
import {loadWorkspaceAccess} from './workspace-access';
import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';
import {accountCall,parsePersonal,savePersonalExport,type PersonalAccount} from './worker-account';
import {isWorkerLocal} from './worker-enrollment';import {isCanonicalEmailOrigin} from '../modules/auth/registration/contract/registration-client';import '../styles/worker-account.css';
const profileCopy={
 en:{checkingWorkspace:"Checking workspace access…",workspaceEnded:"This workspace is no longer active for your account.",workspaceUnavailable:"Could not open this workspace. Try again.",workspaceLogin:"Your session expired. Sign in again to open the workspace.",backWorkspace:"Back to workspace",backProfile:"Back to profile",backSettings:"Back to account settings",archive:'Personal archive',archiveHint:'Your archived timecards and issued payslips, including from previous workplaces. Find current shifts in your workspace.',archiveUnavailable:'Your profile and personal archive could not be loaded. Password settings are separate.',recovery:'If you can still access your email, use a sign-in code. Timeax cannot automatically restore access to an account if you no longer control its email.',loginEmail:'Sign-in email'},
 pl:{checkingWorkspace:"Sprawdzamy dostęp do panelu…",workspaceEnded:"To konto nie ma już dostępu do tego panelu.",workspaceUnavailable:"Nie udało się otworzyć tego panelu. Spróbuj ponownie.",workspaceLogin:"Sesja wygasła. Zaloguj się ponownie, aby otworzyć panel.",backWorkspace:"Wróć do panelu",backProfile:"Wróć do profilu",backSettings:"Wróć do ustawień konta",archive:'Archiwum osobiste',archiveHint:'Twoje zarchiwizowane ewidencje i wystawione rozliczenia, także z wcześniejszych miejsc pracy. Bieżące zmiany znajdziesz w panelu pracy.',archiveUnavailable:'Nie udało się wczytać profilu i archiwum osobistego. Ustawienia hasła działają niezależnie.',recovery:'Jeżeli nadal masz dostęp do poczty, użyj kodu logowania. Timeax nie może automatycznie przywrócić dostępu do konta bez dostępu do jego adresu e-mail.',loginEmail:'E-mail do logowania'},
 ru:{checkingWorkspace:"Проверяем доступ к кабинету…",workspaceEnded:"Этот кабинет больше не доступен для вашего аккаунта.",workspaceUnavailable:"Не удалось открыть кабинет. Попробуйте ещё раз.",workspaceLogin:"Сессия закончилась. Войдите заново, чтобы открыть кабинет.",backWorkspace:"Вернуться в кабинет",backProfile:"Вернуться в профиль",backSettings:"Вернуться к настройкам аккаунта",archive:'Личный архив',archiveHint:'Ваши сохранённые табели и выданные расчётные листки, в том числе с прежних мест работы. Текущие смены смотрите в рабочем кабинете.',archiveUnavailable:'Не удалось загрузить профиль и личный архив. Настройки пароля работают отдельно.',recovery:'Если у вас ещё есть доступ к почте, войдите по коду из письма. Без доступа к этой почте Timeax не может автоматически восстановить аккаунт.',loginEmail:'Почта для входа'},
 uk:{checkingWorkspace:"Перевіряємо доступ до кабінету…",workspaceEnded:"Цей кабінет більше недоступний для вашого акаунта.",workspaceUnavailable:"Не вдалося відкрити кабінет. Спробуйте ще раз.",workspaceLogin:"Сесія завершилася. Увійдіть знову, щоб відкрити кабінет.",backWorkspace:"Повернутися до кабінету",backProfile:"Повернутися до профілю",backSettings:"Повернутися до налаштувань акаунта",archive:'Особистий архів',archiveHint:'Ваші збережені табелі й видані розрахункові листки, зокрема з попередніх місць роботи. Поточні зміни переглядайте в робочому кабінеті.',archiveUnavailable:'Не вдалося завантажити профіль і особистий архів. Налаштування пароля працюють окремо.',recovery:'Якщо у вас іще є доступ до пошти, увійдіть за кодом із листа. Без доступу до цієї пошти Timeax не може автоматично відновити обліковий запис.',loginEmail:'Пошта для входу'},
};
const errorKey=(e:unknown)=>e instanceof Error&&['login','denied','conflict','invalid','tryLater'].includes(e.message)?e.message:'unavailable';
export function WorkerAccountPage(){
 const {t,i18n}=useTranslation(),tx=(k:string)=>t('workerAccount.'+k),loc=useLocation(),navigate=useNavigate();
 const copy=profileCopy[(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof profileCopy]??profileCopy.en;
 const [value,setValue]=useState<PersonalAccount>(),[status,setStatus]=useState('checking'),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[closed,setClosed]=useState(false);
 const [email,setEmail]=useState(''),[reference,setReference]=useState(''),[requestId,setRequestId]=useState('');
 const recovery=loc.pathname==='/account/recovery',reauth=loc.pathname==='/account/reauth',settings=loc.pathname==='/account/settings';
 const publicRecovery=recovery&&isCanonicalEmailOrigin(location.origin);
 const enrollment=useWorkerEnrollmentStatus(!recovery&&!reauth&&!closed&&status!=='login',revision,true);
 const connections=enrollment?.memberships;
 const pending=enrollment?.applications.filter(a=>a.status==='pending')??[];
 const waiting=pending.length>0&&!connections?.some(c=>c.role==='worker');
 const observedPending=useRef(new Set<string>());
 const submittedApplication=loc.state?.pendingWorkerApplication;
 useEffect(()=>{
  if(loc.pathname!=='/account'||!enrollment)return;
  for(const application of enrollment.applications){
   if(application.status==='pending')observedPending.current.add(application.id);
   if(application.status==='approved'&&(observedPending.current.has(application.id)||submittedApplication===application.id)&&
    enrollment.memberships.some(m=>m.role==='worker'&&m.organizationId===application.organizationId)){
    const c=new AbortController();
    void persistApprovedWorkerSession(c.signal).then(()=>{
     if(c.signal.aborted)return;
     observedPending.current.clear();
     navigate('/workspace/'+application.organizationId,{replace:true,state:null});
    });
    return()=>c.abort();
   }
  }
 },[enrollment,loc.pathname,navigate,submittedApplication]);
 const workerCopy=workerRegistrationCopy(i18n.resolvedLanguage);
 const canJoin=shouldOfferAgencyJoin(connections);
 const [opening,setOpening]=useState(''),[workspaceProblem,setWorkspaceProblem]=useState<{id:string;status:'workspaceEnded'|'workspaceUnavailable'|'workspaceLogin'}>();
 const workspaceRequest=useRef<AbortController|null>(null);
 useEffect(()=>{
  setOpening('');setWorkspaceProblem(undefined);
  return()=>{workspaceRequest.current?.abort();workspaceRequest.current=null};
 },[loc.key,revision]);
 const workspaceHint=workerWorkspaceHint(loc.state?.workspaceReturn);
 const cabinetMemberships=connections?.filter(c=>c.role==='worker').map(c=>({...c,state:'active'}));
 const workspace=workerWorkspaceReturn(workspaceHint,cabinetMemberships??value?.memberships);
 const history=value?.memberships??[];
 const listed=[...history,...(cabinetMemberships??[]).filter(c=>!history.some(m=>m.membershipId===c.membershipId&&m.organizationId===c.organizationId))];
 const back=workspace??(recovery?'/account':reauth?'/account/settings':status==='login'?'/login':'/');
 const backLabel=workspace?copy.backWorkspace:recovery?copy.backProfile:reauth?copy.backSettings:status==='login'?tx('loginAction'):undefined;
 const returnState=workspace?{workspaceReturn:workspace}:undefined;
 const reload=useCallback(()=>{setValue(undefined);setConfirmed(false);setRevision(n=>n+1)},[]);
 useEffect(()=>{if(recovery||reauth)return;const c=new AbortController();setValue(undefined);setStatus('checking');
 void accountCall('context',undefined,c.signal).then(parsePersonal).then(v=>{if(!c.signal.aborted){setValue(v);setStatus('')}}).catch(async e=>{if(c.signal.aborted)return;if(errorKey(e)==='login'){try{const receipt=await accountCall('deletion-status',undefined,c.signal) as {state:string};if(!c.signal.aborted&&receipt.state==='closed-provider-cleanup-pending'){setClosed(true);setStatus('');return}}catch{}}if(!c.signal.aborted)setStatus(errorKey(e))});return()=>c.abort()
 },[revision,recovery,reauth]);
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setStatus('');try{await fn()}catch(e){setValue(undefined);setStatus(errorKey(e))}finally{setBusy(false)}}
 async function prepare(){await accountCall('begin-delete',{});reload()}
 async function openWorkspace(organizationId:string,membershipId:string){
  if(workspaceRequest.current)return;
  const destination=workerWorkspaceHint('/workspace/'+organizationId);
  if(!destination||connections&&!hasCurrentWorkerWorkspace(connections,organizationId,membershipId))return;
  const c=new AbortController();workspaceRequest.current=c;setOpening(membershipId);setWorkspaceProblem(undefined);
  try{
   const result=await loadWorkspaceAccess(organizationId,location.origin,window.fetch.bind(window),c.signal);
   if(c.signal.aborted)return;
   if(result.state==='ready'&&result.value.membership.role==='worker'&&result.value.membership.id===membershipId){navigate(destination);return}
   setWorkspaceProblem({id:membershipId,status:result.state==='login'?'workspaceLogin':result.state==='unavailable'?'workspaceUnavailable':'workspaceEnded'});
  }finally{if(workspaceRequest.current===c){workspaceRequest.current=null;setOpening('')}}
 }
 const workspaces=<>
  {(!waiting||listed.length>0)&&<h2>{tx('organizations')}</h2>}{!waiting&&!listed.length&&<p>{tx('emptyOrganizations')}</p>}
  {listed.map(m=>{
   const active=m.state==='active'&&(!connections||hasCurrentWorkerWorkspace(connections,m.organizationId,m.membershipId));
   return <article className="notice-box" key={m.membershipId}><h3>{m.name}</h3>
    <p>{m.state==='active'&&!active?copy.workspaceEnded:tx(m.state)}{'endedAt' in m&&m.endedAt?' · '+new Date(m.endedAt).toLocaleDateString():''}</p>
    {active&&<button type="button" className="button button--outline" disabled={Boolean(opening)} onClick={()=>void openWorkspace(m.organizationId,m.membershipId)}>{opening===m.membershipId?copy.checkingWorkspace:tx('workspace')}</button>}
    {workspaceProblem?.id===m.membershipId&&<p role="alert">{copy[workspaceProblem.status]} {workspaceProblem.status==='workspaceLogin'&&<Link to="/login">{tx('loginAction')}</Link>}</p>}
   </article>;
  })}
  {canJoin&&!waiting&&<Link className="button button--primary" to="/register/worker" state={returnState}>{tx('join')}</Link>}
 </>;
 return <RegistrationFrame title={tx(recovery?'recoveryTitle':reauth?'reauthTitle':'title')} lead={publicRecovery?'':tx(recovery?'recoveryLead':'lead')} back={back} backLabel={backLabel}>
 <div className="personal-account" aria-busy={busy}>
 {pending.length>0&&<section className="notice-box" aria-labelledby="pending-agency-title">
  <h2 id="pending-agency-title">{workerCopy.pending}</h2>
  <ul>{pending.map(application=><li key={application.id}><strong>{application.name}</strong><PendingApplicationDetails applicationId={application.id}/></li>)}</ul>
  {waiting&&<p>{workerCopy.pendingHours}</p>}
  <button className="button button--outline" type="button" disabled={busy} onClick={reload}>{workerCopy.checkApplication}</button>
 </section>}

 {publicRecovery?<><p>{copy.recovery}</p><div className="form-actions"><Link className="button button--primary" to={PASSWORD_RESET_PATH}>{passwordResetHeading(i18n.resolvedLanguage??'en')}</Link><Link className="button button--outline" to="/login?method=code">{tx('loginAction')}</Link></div></>:
 recovery?<><p className="notice-box">{tx('proofBoundary')}</p>{requestId?<div role="status"><h2>{tx('requestSaved')}</h2><p>{tx('requestPending')}</p><code>{requestId}</code></div>:<form className="auth-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await accountCall('recovery-request',{contactEmail:email,reference}) as {status:string;requestId:string;accessChanged:boolean;mailSent:boolean};if(r.status!=='received-awaiting-independent-proof'||r.accessChanged||r.mailSent)throw Error();setRequestId(r.requestId);setEmail('');setReference('')})}}>
 <label className="field-label" htmlFor="recovery-email">{tx('contactEmail')}<input id="recovery-email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label className="field-label" htmlFor="recovery-reference">{tx('reference')}<textarea id="recovery-reference" required minLength={2} maxLength={200} rows={3} value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <p>{tx('noDocuments')}</p><button className="button button--primary button--full" disabled={busy}>{tx('request')}</button></form>}<p>{tx('hiringIndependent')}</p><Link to="/register/worker">{tx('join')}</Link></>:
 reauth?<><p>{tx('reauthLead')}</p>{isWorkerLocal()?<Link className="button button--primary button--full" to="/login">{tx('loginAction')}</Link>:<><PrivateAccess onOpened={reload}/><StagingSessionPanel purpose="existing" audience="workspace" guided onChanged={reload}/></>}
 <Link className="button button--outline button--full" to="/account/settings" state={returnState}>{tx('returnSettings')}</Link></>:
 closed?<div className="notice-box" role="status"><h2>{tx('closedTitle')}</h2><p>{tx('closedBody')}</p></div>:
 value?<><nav aria-label={tx('navigation')}><Link to="/account" state={returnState} aria-current={!settings?'page':undefined}>{copy.archive}</Link> · <Link to="/account/settings" state={returnState} aria-current={settings?'page':undefined}>{tx('settings')}</Link></nav>
 {value.email&&<p className="notice-box personal-sign-in-email"><strong>{copy.loginEmail}:</strong> {value.email}</p>}
 {workspaces}
 {!settings&&<><h2>{copy.archive}</h2><p>{copy.archiveHint}</p>{!value.timecards.length&&!value.payslips.length&&<p>{tx('emptyHistory')}</p>}
 {value.timecards.map(s=><details className="notice-box" key={s.kind+s.sourceId+s.workerKey}><summary>{tx('timecard')} · {s.agencyName} · {s.siteName} · {s.dateFrom} — {s.dateTo}</summary><p>{tx(s.kind)} · {s.paidMinutes} {tx('minutes')}</p><ul>{s.rows.map(r=><li key={r.id}>{r.data.localDate}: {r.data.paidMinutes} {tx('minutes')}</li>)}</ul></details>)}
 {value.payslips.map(p=><details className="notice-box" key={p.id}><summary>{tx('payslip')} · {p.document.source.agencyName} · {p.document.source.dateFrom} — {p.document.source.dateTo}</summary><p>{p.document.source.siteName}</p><PayslipAmounts value={p.document.calculation}/><p>{tx('issued')}: {new Date(p.issued_at).toLocaleString()}</p><PayslipPdfButton publication={p} disabled={busy}/></details>)}
 <button className="button button--outline button--full" disabled={busy} onClick={()=>void run(async()=>{const r=await accountCall('export');parsePersonal({...r as object,deletionState:'none'});savePersonalExport(r)})}>{tx('export')}</button></>}
 {settings&&value.deletionAvailable!==false&&<section className="personal-deletion"><h2>{tx('deleteTitle')}</h2><p>{tx('deleteLead')}</p><p>{tx('retention')}</p>
 {value.deletionState==='none'?<button className="button button--outline button--full" disabled={busy} onClick={()=>void run(prepare)}>{tx('prepareDelete')}</button>:
 value.deletionState==='reauthentication-required'?<><p>{tx('reauthLead')}</p><Link className="button button--primary button--full" to="/account/reauth" state={returnState}>{tx('reauthTitle')}</Link></>:
 <><label className="personal-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{tx('confirmDelete')}</span></label><button className="button button--primary button--full" disabled={busy||!confirmed} onClick={()=>void run(async()=>{const r=await accountCall('delete',{operationId:crypto.randomUUID(),confirmed:true}) as {state:string};if(r.state!=='closed-provider-cleanup-pending')throw Error();setClosed(true);setValue(undefined);setConfirmed(false)})}>{tx('deleteAction')}</button></>}</section>}
 <button className="button button--outline button--full" disabled={busy} onClick={reload}>{tx('refresh')}</button></>:null}
 {!value&&!recovery&&!reauth&&!closed&&connections&&workspaces}
 {!recovery&&!reauth&&!closed&&status!=='login'&&(waiting||settings)&&<WorkerPasswordPanel/>}
 {status&&(!waiting||!['denied','checking'].includes(status))&&<p className="notice-box" role="status">{!recovery&&!reauth&&status==='unavailable'?copy.archiveUnavailable:tx(status)}</p>}
 {!recovery&&!reauth&&!value&&!closed&&!waiting&&<button className="button button--outline button--full" disabled={busy} onClick={reload}>{tx('refresh')}</button>}
 {!recovery&&!reauth&&status==='login'&&!value&&!closed&&<div className="form-actions"><Link className="button button--primary" to="/login">{tx('loginAction')}</Link><Link to="/account/recovery" state={returnState}>{tx('recoveryTitle')}</Link></div>}
 </div></RegistrationFrame>
}
function PendingApplicationDetails({applicationId}:{applicationId:string}){
 const {t}=useTranslation();
 const [first,setFirst]=useState(''),[last,setLast]=useState(''),[status,setStatus]=useState<'busy'|'saved'|'error'>();
 const operation=useRef<AbortController|null>(null);
 useEffect(()=>()=>operation.current?.abort(),[]);
 async function save(){
  if(operation.current||!first.trim()||!last.trim())return;
  const c=new AbortController();operation.current=c;setStatus('busy');
  try{
   const result=await workerCall('application-details',{applicationId,firstName:first.trim(),lastName:last.trim()},c.signal) as {state?:string};
   if(result?.state!=='saved')throw Error();
   if(!c.signal.aborted){setStatus('saved');setFirst('');setLast('')}
  }catch{if(!c.signal.aborted)setStatus('error')}
  finally{if(operation.current===c)operation.current=null}
 }
 return <details>
  <summary>{t('workerEnrollment.applicantEdit')}</summary>
  <form className="auth-form" onSubmit={e=>{e.preventDefault();void save()}}>
   <ApplicationNameFields first={first} last={last} onFirst={setFirst} onLast={setLast} disabled={status==='busy'}/>
   <button type="submit" className="button button--primary" disabled={status==='busy'||!first.trim()||!last.trim()}>{t('workerEnrollment.applicantSave')}</button>
   {status==='saved'&&<p role="status">{t('workerEnrollment.applicantSaved')}</p>}
   {status==='error'&&<p role="alert">{t('workerEnrollment.applicantError')}</p>}
  </form>
 </details>;
}
export function AgencyLifecyclePanel({organizationId,refreshKey=0}:{organizationId:string;refreshKey?:number}){
 const {t}=useTranslation(),tx=(k:string)=>t('workerAccount.'+k),[workers,setWorkers]=useState<{membershipId:string;state:string;endedAt:string|null}[]>(),[selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const c=new AbortController();setWorkers(undefined);setSelected('');setConfirmed(false);void accountCall('agency-context',{organizationId},c.signal).then(v=>{const x=v as {organizationId:string;workers:typeof workers};if(x.organizationId!==organizationId||!Array.isArray(x.workers))throw Error();if(!c.signal.aborted)setWorkers(x.workers)}).catch(e=>{if(!c.signal.aborted)setStatus(errorKey(e))});return()=>c.abort()},[organizationId,revision,refreshKey]);
 const {label}=useMemberNames(organizationId,refreshKey+revision);
 return <section className="personal-account"><h2>{tx('endTitle')}</h2><p>{tx('endLead')}</p>{workers&&<form className="auth-form" onSubmit={e=>{e.preventDefault();if(busy||!confirmed||!selected)return;setBusy(true);setStatus('');void accountCall('end-membership',{organizationId,membershipId:selected,operationId:crypto.randomUUID(),confirmed:true}).then(v=>{if((v as {state:string}).state!=='ended')throw Error();setStatus('ended');setRevision(n=>n+1)}).catch(e=>{setStatus(errorKey(e));setWorkers(undefined)}).finally(()=>setBusy(false))}}>
 <label className="field-label" htmlFor="end-worker">{tx('workerReference')}<select id="end-worker" value={selected} onChange={e=>{setSelected(e.target.value);setConfirmed(false)}}><option value="">{tx('choose')}</option>{workers.filter(w=>w.state==='active').map(w=><option key={w.membershipId} value={w.membershipId}>{label(w.membershipId)}</option>)}</select></label>
 <label className="personal-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{tx('confirmEnd')}</span></label><button className="button button--outline button--full" disabled={busy||!selected||!confirmed}>{tx('endAction')}</button>
 <p>{tx('endedCount')}: {workers.filter(w=>w.endedAt).length}</p></form>}{status&&<p role="status">{tx(status)}</p>}</section>
}
