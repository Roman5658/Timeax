import {PayslipAmounts} from './PayslipAmounts';
import {PayslipPdfButton} from './PayslipPdfButton';
import {useMemberNames} from './MemberNames';
import {useCallback,useEffect,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';import {PrivateAccess} from './PrivateAccess';
import {WorkerPasswordPanel} from './WorkerPasswordPanel';
import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';
import {accountCall,parsePersonal,savePersonalExport,type PersonalAccount} from './worker-account';
import {isWorkerLocal} from './worker-enrollment';import '../styles/worker-account.css';
const errorKey=(e:unknown)=>e instanceof Error&&['login','denied','conflict','invalid','tryLater'].includes(e.message)?e.message:'unavailable';
export function WorkerAccountPage(){
 const {t}=useTranslation(),tx=(k:string)=>t('workerAccount.'+k),loc=useLocation();
 const [value,setValue]=useState<PersonalAccount>(),[status,setStatus]=useState('checking'),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[closed,setClosed]=useState(false);
 const [email,setEmail]=useState(''),[reference,setReference]=useState(''),[requestId,setRequestId]=useState('');
 const recovery=loc.pathname==='/account/recovery',reauth=loc.pathname==='/account/reauth';
 const reload=useCallback(()=>{setValue(undefined);setConfirmed(false);setRevision(n=>n+1)},[]);
 useEffect(()=>{if(recovery||reauth)return;const c=new AbortController();setValue(undefined);setStatus('checking');
 void accountCall('context',undefined,c.signal).then(parsePersonal).then(v=>{if(!c.signal.aborted){setValue(v);setStatus('')}}).catch(async e=>{if(c.signal.aborted)return;if(errorKey(e)==='login'){try{const receipt=await accountCall('deletion-status',undefined,c.signal) as {state:string};if(!c.signal.aborted&&receipt.state==='closed-provider-cleanup-pending'){setClosed(true);setStatus('');return}}catch{}}if(!c.signal.aborted)setStatus(errorKey(e))});return()=>c.abort()
 },[revision,recovery,reauth]);
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setStatus('');try{await fn()}catch(e){setValue(undefined);setStatus(errorKey(e))}finally{setBusy(false)}}
 async function prepare(){await accountCall('begin-delete',{});reload()}
 return <RegistrationFrame title={tx(recovery?'recoveryTitle':reauth?'reauthTitle':'title')} lead={tx(recovery?'recoveryLead':'lead')}>
 <div className="personal-account" aria-busy={busy}>
 {loc.pathname==='/account/settings'&&!closed&&<WorkerPasswordPanel/>}
 {recovery?<><p className="notice-box">{tx('proofBoundary')}</p>{requestId?<div role="status"><h2>{tx('requestSaved')}</h2><p>{tx('requestPending')}</p><code>{requestId}</code></div>:<form className="auth-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await accountCall('recovery-request',{contactEmail:email,reference}) as {status:string;requestId:string;accessChanged:boolean;mailSent:boolean};if(r.status!=='received-awaiting-independent-proof'||r.accessChanged||r.mailSent)throw Error();setRequestId(r.requestId);setEmail('');setReference('')})}}>
 <label className="field-label" htmlFor="recovery-email">{tx('contactEmail')}<input id="recovery-email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label className="field-label" htmlFor="recovery-reference">{tx('reference')}<textarea id="recovery-reference" required minLength={2} maxLength={200} rows={3} value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <p>{tx('noDocuments')}</p><button className="button button--primary button--full" disabled={busy}>{tx('request')}</button></form>}<p>{tx('hiringIndependent')}</p><Link to="/register/worker">{tx('join')}</Link></>:
 reauth?<><p>{tx('reauthLead')}</p>{isWorkerLocal()?<Link className="button button--primary button--full" to="/login">{tx('loginAction')}</Link>:<><PrivateAccess onOpened={reload}/><StagingSessionPanel purpose="existing" audience="workspace" guided onChanged={reload}/></>}
 <Link className="button button--outline button--full" to="/account/settings">{tx('returnSettings')}</Link></>:
 closed?<div className="notice-box" role="status"><h2>{tx('closedTitle')}</h2><p>{tx('closedBody')}</p></div>:
 value?<><nav aria-label={tx('navigation')}><Link to="/account">{tx('history')}</Link> · <Link to="/account/settings">{tx('settings')}</Link> · <Link to="/register/worker">{tx('join')}</Link></nav>
 <h2>{tx('organizations')}</h2>{!value.memberships.length&&<p>{tx('emptyOrganizations')}</p>}
 {value.memberships.map(m=><article className="notice-box" key={m.membershipId}><h3>{m.name}</h3><p>{tx(m.state)}{m.endedAt?' · '+new Date(m.endedAt).toLocaleDateString():''}</p>{m.state==='active'&&<Link to={'/workspace/'+m.organizationId}>{tx('workspace')}</Link>}</article>)}
 <h2>{tx('history')}</h2><p>{tx('historyLead')}</p>{!value.timecards.length&&!value.payslips.length&&<p>{tx('emptyHistory')}</p>}
 {value.timecards.map(s=><details className="notice-box" key={s.kind+s.sourceId+s.workerKey}><summary>{tx('timecard')} · {s.agencyName} · {s.siteName} · {s.dateFrom} — {s.dateTo}</summary><p>{tx(s.kind)} · {s.paidMinutes} {tx('minutes')}</p><ul>{s.rows.map(r=><li key={r.id}>{r.data.localDate}: {r.data.paidMinutes} {tx('minutes')}</li>)}</ul></details>)}
 {value.payslips.map(p=><details className="notice-box" key={p.id}><summary>{tx('payslip')} · {p.document.source.agencyName} · {p.document.source.dateFrom} — {p.document.source.dateTo}</summary><p>{p.document.source.siteName}</p><PayslipAmounts value={p.document.calculation}/><p>{tx('issued')}: {new Date(p.issued_at).toLocaleString()}</p><PayslipPdfButton publication={p} disabled={busy}/></details>)}
 <button className="button button--outline button--full" disabled={busy} onClick={()=>void run(async()=>{const r=await accountCall('export');parsePersonal({...r as object,deletionState:'none'});savePersonalExport(r)})}>{tx('export')}</button>
 {loc.pathname==='/account/settings'&&<section className="personal-deletion"><h2>{tx('deleteTitle')}</h2><p>{tx('deleteLead')}</p><p>{tx('retention')}</p>
 {value.deletionState==='none'?<button className="button button--outline button--full" disabled={busy} onClick={()=>void run(prepare)}>{tx('prepareDelete')}</button>:
 value.deletionState==='reauthentication-required'?<><p>{tx('reauthLead')}</p><Link className="button button--primary button--full" to="/account/reauth">{tx('reauthTitle')}</Link></>:
 <><label className="personal-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{tx('confirmDelete')}</span></label><button className="button button--primary button--full" disabled={busy||!confirmed} onClick={()=>void run(async()=>{const r=await accountCall('delete',{operationId:crypto.randomUUID(),confirmed:true}) as {state:string};if(r.state!=='closed-provider-cleanup-pending')throw Error();setClosed(true);setValue(undefined);setConfirmed(false)})}>{tx('deleteAction')}</button></>}</section>}
 <button className="button button--outline button--full" disabled={busy} onClick={reload}>{tx('refresh')}</button></>:null}
 {status&&<p className="notice-box" role="status">{tx(status)}</p>}
 {!recovery&&!reauth&&!value&&!closed&&<button className="button button--outline button--full" disabled={busy} onClick={reload}>{tx('refresh')}</button>}
 <p><Link to="/login">{tx('loginAction')}</Link> · <Link to="/account/recovery">{tx('recoveryTitle')}</Link></p>
 </div></RegistrationFrame>
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
