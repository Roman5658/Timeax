import {TeamBell} from './TeamWorkflow';
import {MemberNamesPanel,useMemberNames} from './MemberNames';
import {AgencyLifecyclePanel} from './WorkerAccountPage';
import {PrivateAccess} from './PrivateAccess';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';
import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';
import {workerCall,enrollmentContext,isWorkerLocal,type EnrollmentContext} from './worker-enrollment';
import {parseWorkspaceAccess,loadWorkspaceAccess,type WorkspaceAccess} from './workspace-access';
import '../styles/worker-enrollment.css';
function useContext(revision=0){
 const [value,setValue]=useState<EnrollmentContext>(),[status,setStatus]=useState('checking'),[refresh,setRefresh]=useState(0);
 const reload=useCallback(()=>{setValue(undefined);setRefresh(n=>n+1)},[]);
 useEffect(()=>{const c=new AbortController();setValue(undefined);setStatus('checking');
 void workerCall('context',undefined,c.signal).then(enrollmentContext).then(v=>{if(!c.signal.aborted){setValue(v);setStatus('verified')}}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});
 return()=>c.abort()},[revision,refresh]);
 return {value,status,reload};
}
export function EnrollmentDestinations({revision=0}:{revision?:number}){
 const {t}=useTranslation(),tx=(k:string)=>t('workerEnrollment.'+k),{value,reload}=useContext(revision);
 if(!value)return null;
 return <section className="worker-enrollment"><h2>{tx('destinations')}</h2>
 {value.memberships.map(m=><p key={m.membershipId}><Link to={'/workspace/'+m.organizationId}>{m.name} — {tx('workspace')}</Link>{['agency_admin','factory_admin'].includes(m.role)&&<> · <Link to={'/workspace/'+m.organizationId+'/setup'}>{t('factoryEnrollment.title')}</Link></>}{m.kind==='agency'&&['worker','agency_admin'].includes(m.role)&&<> | <Link to={'/workspace/'+m.organizationId+'/timecards'}>{t('timecards.title')}</Link></>}{['worker','agency_admin','factory_admin','team_leader'].includes(m.role)&&<> | <Link to={'/workspace/'+m.organizationId+'/factory-timecards'}>{t('factoryHours.title')}</Link></>}{m.kind==='agency'&&['worker','agency_admin','accountant'].includes(m.role)&&<> | <Link to={'/workspace/'+m.organizationId+'/payslips'}>{t('canonicalPayslips.title')}</Link></>}{m.role==='team_leader'&&<><TeamBell organizationId={m.organizationId}/><Link to={'/workspace/'+m.organizationId+'/schedule'}>{t('team.schedule')}</Link></>}{m.role==='team_leader'&&<> · <Link to='/leader/access'>{t('factoryEnrollment.leaderEntry')}</Link></>}{m.role==='agency_admin'&&<> · <Link to={'/workspace/'+m.organizationId+'/workers'}>{tx('manage')}</Link></>}</p>)}
 {value.memberships.every(m=>m.role==='worker')&&<Link className="button button--outline button--full" to="/account">{t('workerAccount.title')}</Link>}
 {!value.memberships.length&&<p>{tx('noMembership')}</p>}
 <Link className="button button--outline button--full" to="/register/worker">{tx('join')}</Link><button className="button button--outline button--full" onClick={reload}>{tx('refresh')}</button></section>;
}
export function WorkerEnrollmentPanel({revision=0}:{revision?:number}){
 const {t}=useTranslation(),tx=(k:string)=>t('workerEnrollment.'+k),{value,status,reload}=useContext(revision);
 const [nip,setNip]=useState(''),[agency,setAgency]=useState<{agency_id:string;name:string;nip:string}|null>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [code,setCode]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('invite')??'');
 const op=useRef(false);
 useEffect(()=>{if(location.hash.startsWith('#invite='))history.replaceState(history.state,'',location.pathname)},[]);
 async function run(task:()=>Promise<void>){if(op.current)return;op.current=true;setBusy(true);setNotice('');try{await task()}catch{setAgency(undefined);setNotice('uncertain');reload()}finally{op.current=false;setBusy(false)}}
 return <section className="worker-enrollment" aria-busy={busy}>
 {!value?<p className="notice-box" role="status">{tx(status)}</p>:<>
 <p className="notice-box">{tx('verified')}</p>
 {value.applications.map(a=>{const closed=a.status==='approved'&&!value.memberships.some(m=>m.organizationId===a.organizationId&&m.role==='worker');return <article className="notice-box" key={a.id}><h2>{a.name}</h2><strong data-testid="worker-status">{closed?t('workerAccount.revoked'):tx(a.status)}</strong><p>{closed?t('workerAccount.historyLead'):tx(a.status==='pending'?'pendingHint':'approvedHint')}</p><p>{tx('reference')}: <code>{a.id}</code></p></article>})}
 {value.memberships.filter(m=>m.role==='worker').map(m=><Link key={m.membershipId} className="button button--primary button--full" to={'/workspace/'+m.organizationId}>{tx('workspace')}: {m.name}</Link>)}
 <Link to="/account">{t("workerAccount.title")}</Link><h2>{tx('invitationTitle')}</h2><p>{tx('codeHint')}</p>
 <form className="auth-form" onSubmit={e=>{e.preventDefault();if(!/^[0-9a-f]{64}$/.test(code.trim())){setNotice('invalidCode');return}void run(async()=>{await workerCall('claim',{code:code.trim()});setCode('');reload()})}}>
 <label className="field-label" htmlFor="agency-invite"><span>{tx('inviteCode')}</span><input id="agency-invite" autoComplete="off" spellCheck={false} maxLength={64} value={code} disabled={busy} onChange={e=>setCode(e.target.value)}/></label>
 <button className="button button--primary button--full" disabled={busy||!code.trim()}>{tx('claim')}</button></form>
 <h2>{tx('nipTitle')}</h2><p>{tx('nipHint')}</p>
 <form className="auth-form" onSubmit={e=>{e.preventDefault();if(!/^[0-9]{10}$/.test(nip)){setNotice('invalidNip');return}void run(async()=>{const r=await workerCall('lookup',{nip}) as {agency:typeof agency};setAgency(r.agency??null)})}}>
 <label className="field-label" htmlFor="worker-nip"><span>NIP</span><input id="worker-nip" inputMode="numeric" maxLength={10} value={nip} disabled={busy} onChange={e=>{setNip(e.target.value);setAgency(undefined)}}/></label>
 <button className="button button--outline button--full" disabled={busy||!nip}>{tx('find')}</button></form>
 {agency===null&&<p role="status">{tx('notFound')}</p>}
 {agency&&<div className="notice-box"><h3>{agency.name}</h3><p>NIP: {agency.nip}</p><button className="button button--primary button--full" disabled={busy} onClick={()=>void run(async()=>{await workerCall('request',{agencyId:agency.agency_id,nip:agency.nip});setAgency(undefined);reload()})}>{tx('request')}</button></div>}
 </>}
 {notice&&<p className="registration-error" role="alert">{tx(notice)}</p>}
 <button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={()=>{setNotice('');reload()}}>{tx('refresh')}</button>
 {!value&&<Link to="/login">{tx('loginAction')}</Link>}
 </section>;
}
export function AgencyWorkerPanel({organizationId}:{organizationId:string}){
 const {t}=useTranslation(),tx=(k:string)=>t('workerEnrollment.'+k),{value,status,reload}=useContext();
 const [queue,setQueue]=useState<{application_id:string;claimed_at:string}[]>(),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[queueRevision,setQueueRevision]=useState(0);
 const allowed=value?.memberships.some(m=>m.organizationId===organizationId&&m.role==='agency_admin');
 useEffect(()=>{setQueue(undefined);if(!allowed)return;const c=new AbortController();
 void workerCall('agency/'+organizationId,undefined,c.signal).then(v=>{if(!c.signal.aborted){const rows=(v as {applications:typeof queue}).applications;if(!Array.isArray(rows))throw Error();setQueue(rows)}}).catch(()=>{if(!c.signal.aborted)setNotice('unavailable')});return()=>c.abort()
 },[allowed,organizationId,queueRevision]);
 async function act(action:string,body:unknown){if(busy)return;setBusy(true);setNotice('');try{const v=await workerCall('agency/'+organizationId+'/'+action,body) as {invitation?:{invite_code:string}};
 if(action==='invite')setCode(v.invitation?.invite_code??'');else setQueueRevision(n=>n+1);
 }catch{setQueue(undefined);setNotice('uncertain');reload()}finally{setBusy(false)}}
 const name=value?.memberships.find(m=>m.organizationId===organizationId)?.name;
 return <section className="worker-enrollment"><p className="notice-box" role="status">{tx(allowed?'adminScope':value?'denied':status)}</p>
 {allowed&&<><h2>{name}</h2><button className="button button--primary button--full" disabled={busy} onClick={()=>void act('invite',{minutes:60})}>{tx('createInvite')}</button>
 {code&&<div className="notice-box"><p>{tx('inviteCreated')}</p><label className="field-label">{tx('inviteCode')}<textarea readOnly rows={3} value={code}/></label><label className="field-label">{tx('inviteLink')}<textarea readOnly rows={4} value={location.origin+'/register/worker#invite='+code}/></label></div>}
 <h2>{tx('queue')}</h2><p>{tx('reviewHint')}</p>
 {queue?.length===0&&<p>{tx('emptyQueue')}</p>}
 {queue?.map(a=><article className="notice-box" key={a.application_id}><p>{tx('reference')}: <code>{a.application_id}</code></p><p>{new Date(a.claimed_at).toLocaleString()}</p><button className="button button--primary button--full" disabled={busy} onClick={()=>void act('approve',{applicationId:a.application_id})}>{tx('approve')}</button></article>)}</>}
 {allowed&&<><MemberNamesPanel organizationId={organizationId} revision={queueRevision} onChanged={()=>setQueueRevision(n=>n+1)}/><AgencyLifecyclePanel organizationId={organizationId} refreshKey={queueRevision}/></>}
 {notice&&<p role="alert">{tx(notice)}</p>}<button className="button button--outline button--full" disabled={busy} onClick={()=>{reload();setQueueRevision(n=>n+1)}}>{tx('refresh')}</button>
 <Link to="/register/worker">{tx('join')}</Link></section>;
}
export function WorkerWorkspacePanel({organizationId}:{organizationId:string}){
 const {t}=useTranslation(),tx=(k:string)=>t('workerEnrollment.'+k),[value,setValue]=useState<WorkspaceAccess>(),[status,setStatus]=useState('checking'),[revision,setRevision]=useState(0);
 useEffect(()=>{const c=new AbortController();setValue(undefined);setStatus('checking');void (isWorkerLocal()?workerCall('workspace/'+organizationId,undefined,c.signal):loadWorkspaceAccess(organizationId,location.origin,fetch,c.signal).then(r=>{if(r.state!=='ready')throw Error(r.state);return r.value})).then(v=>{if(c.signal.aborted)return;const result=parseWorkspaceAccess(v,organizationId);if(!result)throw Error();setValue(result)}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>c.abort()},[organizationId,revision]);
 const {label}=useMemberNames(organizationId,revision);
  return <section className="worker-enrollment">{value?<>{value.membership.role==='worker'&&<><p>{label(value.membership.id)}</p><Link to='/account'>{t('workerAccount.title')}</Link></>}<h2>{t('workspaceRead.'+value.membership.role)}</h2><p>{tx('workspaceReady')}</p><h3>{t('workspaceRead.worksites')}</h3>{value.worksites.length?<ul>{value.worksites.map(s=><li key={s.id}>{s.name}</li>)}</ul>:<p>{tx('noAssignment')}</p>}<p>{t('workspaceRead.readOnly')}</p>{value.organization.kind==='agency'&&['worker','agency_admin','accountant'].includes(value.membership.role)&&<Link className="button button--outline button--full" to={'/workspace/'+organizationId+'/payslips'}>{t('canonicalPayslips.title')}</Link>}{['worker','agency_admin','factory_admin','team_leader'].includes(value.membership.role)&&<Link to={'/workspace/'+organizationId+'/factory-timecards'}>{t('factoryHours.title')}</Link>}{value.organization.kind==='agency'&&['worker','agency_admin'].includes(value.membership.role)&&<Link className="button button--primary button--full" to={'/workspace/'+organizationId+'/timecards'}>{t('timecards.title')}</Link>}{['factory_admin','agency_admin'].includes(value.membership.role)&&<Link to={'/workspace/'+organizationId+'/setup'}>{t('factoryEnrollment.title')}</Link>}{value.membership.role==='agency_admin'&&<Link to={'/workspace/'+organizationId+'/workers'}>{tx('manage')}</Link>}</>:<p role="status">{tx(status)}</p>}
 <button className="button button--outline button--full" onClick={()=>setRevision(n=>n+1)}>{tx('refresh')}</button><Link to="/register/worker">{tx('join')}</Link></section>;
}
export function WorkerEnrollmentEntry(){
 const {t}=useTranslation(),[revision,setRevision]=useState(0),[accessRevision,setAccessRevision]=useState(0),[existing,setExisting]=useState(true);
 return <RegistrationFrame title={t('roleEntry.workerTitle')} lead={t('publicExperience.workerPath')}>
 {!isWorkerLocal()&&<PrivateAccess onOpened={()=>{setAccessRevision(n=>n+1);setRevision(n=>n+1)}}/>}
 {!isWorkerLocal()&&<><div><button className="button button--outline" aria-pressed={existing} onClick={()=>setExisting(true)}>{t('workerAccount.loginAction')}</button><button className="button button--outline" aria-pressed={!existing} onClick={()=>setExisting(false)}>{t('workerAccount.newAccount')}</button></div><StagingSessionPanel key={String(existing)+accessRevision} purpose={existing?'existing':'enrollment'} guided audience="worker" onChanged={()=>setRevision(n=>n+1)}/></>}
 <p className="muted-copy">{t('publicExperience.codePurpose')}</p><p><Link to='/login'>{t('workerAccount.loginAction')}</Link> | <Link to='/account/recovery'>{t('workerAccount.recoveryTitle')}</Link></p><WorkerEnrollmentPanel revision={revision}/></RegistrationFrame>;
}
export function WorkerRoutePage(){
 const loc=useLocation(),{t}=useTranslation(),m=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)(\/workers)?$/);
 if(!m)return <WorkerEnrollmentEntry/>;
 return <RegistrationFrame title={t('workerEnrollment.'+(m[2]?'manage':'workspace'))} lead={t('workerEnrollment.adminScope')}>{m[2]?<AgencyWorkerPanel organizationId={m[1]}/>:<WorkerWorkspacePanel organizationId={m[1]}/>}</RegistrationFrame>;
}
