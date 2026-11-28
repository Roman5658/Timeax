import {useMemberNames,MemberNamesPanel} from './MemberNames';
import {FactoryIndependencePanel} from './FactoryIndependencePanel';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';import {Link,useLocation,useNavigate} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {LegalLink,RegistrationFrame} from '../components/PublicExperience';import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';import {PrivateAccess} from './PrivateAccess';
import {createWorkingRegistrationClient,isEmailIdentityOrigin,type AccessContext} from '../modules/auth/registration/contract/registration-client';
import {workerRegistrationCopy} from './worker-registration-copy';
import {isWorkerLocal} from './worker-enrollment';import {factoryCall,parseSetupContext,type SetupContext} from './factory-enrollment';
import {resolveFactoryClaim} from './factory-claim';
import '../styles/worker-enrollment.css';import '../styles/factory-enrollment.css';
export function FactorySetupPanel({organizationId,revision=0,leader=false}:{organizationId?:string;revision?:number;leader?:boolean}){
 const {t}=useTranslation(),tx=(k:string)=>t('factoryEnrollment.'+k);
 const [context,setContext]=useState<SetupContext>(),[status,setStatus]=useState('checking'),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [orgId,setOrgId]=useState(organizationId??''),[name,setName]=useState(''),[siteId,setSiteId]=useState(''),[nip,setNip]=useState(''),[workerId,setWorkerId]=useState(''),[start,setStart]=useState(new Date().toISOString().slice(0,10));
 const {label}=useMemberNames(orgId,revision+refresh);
 const [invite,setInvite]=useState<{code:string;expiresAt:string}>(),[code,setCode]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('invite')??''),[confirmed,setConfirmed]=useState<Record<string,boolean>>({});
 const operation=useRef(crypto.randomUUID()),pending=useRef(false),reload=useCallback(()=>{setContext(undefined);setRefresh(n=>n+1)},[]);
 useEffect(()=>{if(location.hash.startsWith('#invite='))history.replaceState(history.state,'',location.pathname)},[]);
 useEffect(()=>{const c=new AbortController();setStatus('checking');setContext(undefined);void factoryCall('context',undefined,c.signal).then(parseSetupContext).then(v=>{if(!c.signal.aborted){setContext(v);setStatus('verified')}}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>c.abort()},[revision,refresh]);
 const admins=context?.memberships.filter(m=>['agency_admin','factory_admin'].includes(m.role))??[],selected=admins.find(m=>m.organizationId===orgId);
 const sites=context?.worksites.filter(w=>w.ownerId===orgId&&w.organizationId===orgId)??[];
 useEffect(()=>{if(context&&!admins.some(m=>m.organizationId===orgId)){setOrgId(admins[0]?.organizationId??'');setSiteId('')}},[context,orgId]);
 async function act(action:string,input:unknown){if(pending.current)return;pending.current=true;setBusy(true);setNotice('');try{
 const result=await factoryCall(action,input);
 if(action==='invite-leader'){const v=result as {code:string;expiresAt:string};if(!/^[0-9a-f]{64}$/.test(v.code??''))throw Error();setInvite(v)}
 if(action==='create-site'){operation.current=crypto.randomUUID();setName('')}
 if(action==='claim-leader')setCode('');
 setNotice('saved');reload();
 }catch{setNotice('uncertain');reload()}finally{pending.current=false;setBusy(false)}}
 const startsAt=()=>start+'T00:00:00.000Z';
 const validStart=()=>/^\d{4}-\d{2}-\d{2}$/.test(start);
 const siteLabel=(id:string)=>context?.worksites.find(w=>w.id===id)?.name??id;
 return <section className="worker-enrollment factory-setup" aria-busy={busy}>
 {!context?<><p className="notice-box" role="status">{t('workerEnrollment.'+status)}</p><Link to="/login">{t('common.login')}</Link></>:<>
 {!context.memberships.length&&<p className="notice-box" role="status">{tx('representativeGate')}</p>}

 {!leader&&admins.length>0&&<>
 <label className="field-label">{tx('organization')}<select value={orgId} disabled={busy} onChange={e=>{setOrgId(e.target.value);setSiteId('');setWorkerId('');setInvite(undefined);operation.current=crypto.randomUUID()}}>{admins.map(m=><option value={m.organizationId} key={m.id}>{m.name} · {tx(m.kind)}</option>)}</select></label>
 {selected&&<><MemberNamesPanel organizationId={orgId} revision={revision+refresh} onChanged={()=>setRefresh(n=>n+1)}/><h2>{tx(selected.kind==='agency'?'internalTitle':'factoryTitle')}</h2><p className="notice-box">{tx(selected.kind==='agency'?'internalHint':'factoryHint')}</p>
 <form className="auth-form" onSubmit={e=>{e.preventDefault();if(name.trim())void act('create-site',{organizationId:orgId,name:name.trim(),operationId:operation.current})}}>
 <label className="field-label">{tx('siteName')}<input value={name} maxLength={120} required disabled={busy} onChange={e=>{setName(e.target.value);operation.current=crypto.randomUUID()}}/></label>
 <button className="button button--primary button--full" disabled={busy||!name.trim()}>{tx('createSite')}</button></form>
 <label className="field-label">{tx('chooseSite')}<select value={siteId} disabled={busy} onChange={e=>setSiteId(e.target.value)}><option value="">{tx('select')}</option>{sites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
 {selected.kind==='agency'?<form className="auth-form" onSubmit={e=>{e.preventDefault();if(siteId&&workerId&&validStart())void act('assign-internal',{worksiteId:siteId,membershipId:workerId,startsAt:startsAt()})}}>
 <h3>{tx('assignWorker')}</h3><p>{tx('workerReference')}</p><label className="field-label">{tx('worker')}<select value={workerId} disabled={busy} onChange={e=>setWorkerId(e.target.value)}><option value="">{tx('select')}</option>{context.workers.filter(w=>w.organizationId===orgId).map(w=><option key={w.id} value={w.id}>{label(w.id)}</option>)}</select></label>
 <label className="field-label">{tx('starts')}<input type="date" required value={start} disabled={busy} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></label><button className="button button--primary button--full" disabled={busy||!siteId||!workerId||!validStart()}>{tx('assign')}</button></form>:<>
 <form className="auth-form" onSubmit={e=>{e.preventDefault();if(siteId&&/^[0-9]{10}$/.test(nip))void act('request-connection',{worksiteId:siteId,agencyNip:nip})}}>
 <h3>{tx('requestTitle')}</h3><label className="field-label">{tx('agencyNip')}<input inputMode="numeric" maxLength={10} required value={nip} disabled={busy} onChange={e=>setNip(e.target.value)}/></label><button className="button button--primary button--full" disabled={busy||!siteId||!/^[0-9]{10}$/.test(nip)}>{tx('request')}</button></form>
 <form className="auth-form" onSubmit={e=>{e.preventDefault();if(siteId&&validStart())void act('invite-leader',{worksiteId:siteId,startsAt:startsAt()})}}>
 <h3>{tx('leaderInvite')}</h3><p>{tx('leaderHint')}</p><label className="field-label">{tx('starts')}<input type="date" required value={start} disabled={busy} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></label>
 <button className="button button--primary button--full" disabled={busy||!siteId||!validStart()||!context.connections.some(c=>c.worksiteId===siteId&&c.state==='active')}>{tx('createInvite')}</button></form>
 {invite&&<div className="notice-box"><p>{tx('oneHour')} {new Date(invite.expiresAt).toLocaleString()}</p><label className="field-label">{tx('inviteCode')}<textarea readOnly rows={3} value={invite.code}/></label><label className="field-label">{tx('inviteLink')}<textarea readOnly rows={4} value={location.origin+'/leader/access#invite='+invite.code}/></label></div>}
 </>}</>}
 </>}
 {leader&&<><h2>{tx('claimTitle')}</h2><p>{tx('codeHint')}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();if(/^[0-9a-f]{64}$/.test(code.trim()))void act('claim-leader',{code:code.trim()});else setNotice('invalidCode')}}>
 <label className="field-label">{tx('inviteCode')}<input autoComplete="off" maxLength={64} value={code} disabled={busy} onChange={e=>setCode(e.target.value)}/></label><button className="button button--primary button--full" disabled={busy||!code.trim()}>{tx('claim')}</button></form></>}
 {context.connections.length>0&&<><h2>{tx('connections')}</h2>{context.connections.map(c=><article className="notice-box" key={c.id}><h3>{c.factoryName} · {c.worksiteName}</h3><p>{tx('agency')}: {c.agencyName}</p><strong data-testid="connection-status">{tx(c.state)}</strong>
 {admins.some(m=>m.organizationId===c.agencyId)&&c.state==='pending'&&<><label className="factory-confirm"><input type="checkbox" checked={!!confirmed[c.id]} onChange={e=>setConfirmed(v=>({...v,[c.id]:e.target.checked}))} disabled={busy}/><span>{tx('confirmSite')}</span></label><button className="button button--primary button--full" disabled={busy||!confirmed[c.id]} onClick={()=>void act('approve-connection',{id:c.id,confirmed:true})}>{tx('approve')}</button><button className="button button--outline button--full" disabled={busy} onClick={()=>void act('decline-connection',{id:c.id})}>{tx('decline')}</button></>}
 {admins.some(m=>m.organizationId===c.agencyId)&&c.state==='active'&&<button className="button button--outline button--full" disabled={busy} onClick={()=>void act('revoke-connection',{id:c.id})}>{tx('revokeConnection')}</button>}</article>)}</>}
 {context.invitations.length>0&&<><h2>{tx('invitations')}</h2>{context.invitations.map(v=><article className="notice-box" key={v.id}><p>{siteLabel(v.worksiteId)} · {tx(v.state)}</p>{v.state==='pending'&&<button className="button button--outline button--full" disabled={busy} onClick={()=>void act('revoke-invitation',{id:v.id})}>{tx('revokeInvite')}</button>}</article>)}</>}
 <h2>{tx('visibleSites')}</h2>{context.worksites.length?<ul>{context.worksites.map(w=><li key={w.organizationId+w.id}>{w.name} · {tx(w.ownerKind==='agency'?'internal':'connected')}</li>)}</ul>:<p data-testid="no-sites">{tx('noSites')}</p>}
 {context.assignments.length>0&&<><h2>{tx('assignments')}</h2>{context.assignments.map(g=><article className="notice-box" key={g.organizationId+g.worksiteId+g.membershipId}><p>{siteLabel(g.worksiteId)}</p><span>{label(g.membershipId)}</span><p>{tx(g.state)} · {new Date(g.startsAt).toLocaleDateString()}</p>{g.state==='active'&&admins.some(m=>m.organizationId===g.organizationId)&&<button className="button button--outline button--full" disabled={busy} onClick={()=>void act('revoke-assignment',{worksiteId:g.worksiteId,membershipId:g.membershipId})}>{tx('revokeAssignment')}</button>}</article>)}</>}
 <p className="muted-copy">{tx('scope')}</p>
 </>}
 {notice&&<p role={notice==='saved'?'status':'alert'}>{tx(notice)}</p>}
 <button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={reload}>{t('workerEnrollment.refresh')}</button>
 <Link to="/leader/access">{tx('leaderEntry')}</Link><Link to="/register/worker">{t('workerEnrollment.join')}</Link>
 </section>;
}
export function FactoryEnrollmentPage(){
 const {t}=useTranslation(),location=useLocation(),leader=location.pathname==='/leader/access',org=location.pathname.match(/^\/workspace\/([0-9a-f-]+)\/setup$/)?.[1];
 const [revision,setRevision]=useState(0),[access,setAccess]=useState(0);
 if(!org&&isEmailIdentityOrigin(window.location.origin))return <PublicFactoryEntry key={location.pathname} leader={leader} worker={location.pathname==='/factory/team/join'} review={location.pathname==='/factory/review'}/>;
 return <RegistrationFrame title={t(location.pathname==='/factory/review'?'factoryIndependent.reviewTitle':location.pathname==='/factory/team/join'?'factoryIndependent.ownWorkerTitle':!org&&!leader?'factoryIndependent.registerTitle':'factoryEnrollment.'+(leader?'claimTitle':'title'))} lead={t(location.pathname==='/factory/team/join'?'factoryIndependent.workerCodeHint':location.pathname==='/factory/review'?'factoryIndependent.reviewHint':!org&&!leader?'factoryIndependent.independentHint':'factoryEnrollment.lead')}>
 {!isWorkerLocal()&&<><PrivateAccess onOpened={()=>{setAccess(n=>n+1);setRevision(n=>n+1)}}/><StagingSessionPanel key={access} guided purpose={!org&&!leader&&['/register/factory','/factory/register'].includes(location.pathname)?'enrollment':'existing'} audience="workspace" onChanged={()=>setRevision(n=>n+1)}/></>}
 {!leader&&<FactoryIndependencePanel organizationId={org} revision={revision} review={location.pathname==='/factory/review'} worker={location.pathname==='/factory/team/join'}/>}
 {(org||leader)&&<FactorySetupPanel organizationId={org} revision={revision} leader={leader}/>}</RegistrationFrame>;
}

function PublicFactoryEntry({leader,worker,review}:{leader:boolean;worker:boolean;review:boolean}){
 const {t,i18n}=useTranslation(),copy=workerRegistrationCopy(i18n.resolvedLanguage);
 const [purpose,setPurpose]=useState<'existing'|'enrollment'>(review?'existing':'enrollment'),[scope,setScope]=useState<AccessContext>(),[revision,refresh]=useState(0),[checking,setChecking]=useState(true);
 const key=leader?'invite':worker?'factoryWorker':'agencyInvite';
 const [initialInvite]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get(key)??'');
 const client=useMemo(()=>createWorkingRegistrationClient(window.location.origin,window.fetch.bind(window),purpose),[purpose]);
 // Retain the factory invitation fragment through email-code verification and reloads.
 // The fragment is not sent to the server; the agency token is only sent in a guarded request body.
 useEffect(()=>{if(key!=='agencyInvite'&&new URLSearchParams(window.location.hash.slice(1)).has(key))history.replaceState(history.state,'',window.location.pathname+window.location.search)},[key]);
 useEffect(()=>{const c=new AbortController();setChecking(true);void client.context(c.signal).then(v=>{if(!c.signal.aborted)setScope(v)}).finally(()=>{if(!c.signal.aborted)setChecking(false)});return()=>c.abort()},[client,revision]);
 return <RegistrationFrame title={t(leader?'factoryEnrollment.claimTitle':worker?'factoryIndependent.ownWorkerTitle':review?'factoryIndependent.reviewTitle':'factoryIndependent.registerTitle')} lead={t(leader?'factoryEnrollment.codeHint':worker?'factoryIndependent.workerCodeHint':review?'factoryIndependent.reviewHint':'factoryIndependent.independentHint')}>
  {checking?<p role="status">{t('closedHosted.checking')}</p>:scope?.state==='verified'?
   leader?<LeaderInvitationClaim initialInvite={initialInvite}/>:<FactoryIndependencePanel initialInvite={initialInvite} revision={revision} worker={worker} review={review}/>:
   <>
    {!review&&<div className="form-actions">
     <button className={'button '+(purpose==='enrollment'?'button--primary':'button--outline')} type="button" aria-pressed={purpose==='enrollment'} onClick={()=>setPurpose('enrollment')}>{copy.newAccount}</button>
     <button className={'button '+(purpose==='existing'?'button--primary':'button--outline')} type="button" aria-pressed={purpose==='existing'} onClick={()=>setPurpose('existing')}>{copy.existingAccount}</button>
    </div>}
    <p className="muted-copy">{copy.otpLead} <LegalLink kind="terms" to="/terms/2026-11-27"/></p>
    <StagingSessionPanel key={purpose} purpose={purpose} guided simple signup={purpose==='enrollment'} onChanged={()=>refresh(n=>n+1)}/>
   </>}
 </RegistrationFrame>;
}

function LeaderInvitationClaim({initialInvite}:{initialInvite:string}){
 const {t}=useTranslation(),navigate=useNavigate(),pending=useRef(false),[code,setCode]=useState(initialInvite),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function claim(){
  if(pending.current||!/^[0-9a-f]{64}$/.test(code.trim()))return;
  pending.current=true;setBusy(true);setNotice('');
  try{
   const result=await factoryCall('claim-leader',{code:code.trim()});
   const destination=resolveFactoryClaim(result,parseSetupContext(await factoryCall('context')),'team_leader');
   if(!destination)throw Error('unavailable');
   navigate(destination,{replace:true});
  }catch(e){setNotice(e instanceof Error&&['login','denied'].includes(e.message)?t('workerEnrollment.'+e.message):t('factoryEnrollment.uncertain'))}
  finally{pending.current=false;setBusy(false)}
 }
 return <form className="auth-form" aria-busy={busy} onSubmit={e=>{e.preventDefault();void claim()}}>
  <label className="field-label">{t('factoryEnrollment.inviteCode')}<input autoComplete="off" maxLength={64} required value={code} disabled={busy} onChange={e=>{setCode(e.target.value);setNotice('')}}/></label>
  <button className="button button--primary" disabled={busy||!/^[0-9a-f]{64}$/.test(code.trim())}>{t('factoryEnrollment.claim')}</button>
  {notice&&<p role="alert">{notice}</p>}
 </form>;
}
