import {useEffect,useRef,useState} from 'react';import {Link} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {factoryCall,parseSetupContext,type SetupContext} from './factory-enrollment';
import {independenceCall,parseIndependence,type FactoryIndependenceContext} from './factory-independence';
export function FactoryIndependencePanel({organizationId,revision=0,review=false,worker=false}:{organizationId?:string;revision?:number;review?:boolean;worker?:boolean}){
 const {t}=useTranslation(),tx=(k:string)=>t('factoryIndependent.'+k);
 const [context,setContext]=useState<FactoryIndependenceContext>(),[setup,setSetup]=useState<SetupContext>(),[refresh,setRefresh]=useState(0),[status,setStatus]=useState('checking'),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [name,setName]=useState(''),[nip,setNip]=useState(''),[siteName,setSiteName]=useState(''),[confirmed,setConfirmed]=useState(false),[reference,setReference]=useState(''),[reviewed,setReviewed]=useState(false);
 const [site,setSite]=useState(''),[start,setStart]=useState(new Date().toISOString().slice(0,10)),[code,setCode]=useState(()=>new URLSearchParams(location.hash.slice(1)).get(worker?'factoryWorker':'agencyInvite')??''),[factoryNip,setFactoryNip]=useState(''),[invite,setInvite]=useState<{code:string;expiresAt:string;worker:boolean}>();
 const pending=useRef(false);
 useEffect(()=>{if(/^#(?:factoryWorker|agencyInvite)=/.test(location.hash))history.replaceState(history.state,'',location.pathname)},[]);
 useEffect(()=>{const c=new AbortController();setContext(undefined);setSetup(undefined);setStatus('checking');
 void Promise.all([independenceCall('context',undefined,c.signal).then(parseIndependence),factoryCall('context',undefined,c.signal).then(parseSetupContext)]).then(([a,b])=>{if(!c.signal.aborted){setContext(a);setSetup(b);setStatus('verified')}}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>c.abort();
 },[revision,refresh,organizationId]);
 const admin=setup?.memberships.find(m=>m.organizationId===organizationId&&['agency_admin','factory_admin'].includes(m.role)),sites=setup?.worksites.filter(w=>w.ownerId===organizationId&&w.organizationId===organizationId)??[];
 async function act(action:string,input:unknown){if(pending.current)return;pending.current=true;setBusy(true);setNotice('');try{
 const result=await independenceCall(action,input) as {code?:string;expiresAt?:string};
 if(action==='invite-worker'||action==='invite-factory'){if(!/^[0-9a-f]{64}$/.test(result.code??'')||!Number.isFinite(Date.parse(result.expiresAt??'')))throw Error();setInvite({code:result.code!,expiresAt:result.expiresAt!,worker:action==='invite-worker'})}
 if(action.startsWith('claim-'))setCode('');
 setNotice('saved');
 }catch(e){setNotice(e instanceof Error&&e.message==='invalid'?'invalid':'uncertain')}finally{setRefresh(n=>n+1);setBusy(false);pending.current=false}}
 const chooseSite=<label className="field-label">{tx('site')}<select value={site} disabled={busy} onChange={e=>{setSite(e.target.value);setInvite(undefined)}} required><option value="">{tx('choose')}</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>;
 return <section className="worker-enrollment" aria-busy={busy}>
 {!context||!setup?<><p className="notice-box" role="status">{tx(status)}</p><Link to="/login">{t('common.login')}</Link></>:<>
 {review?<><h2>{tx('reviewTitle')}</h2><p>{tx('reviewHint')}</p>{context.reviewer?<><label className="field-label">{tx('reference')}<input value={reference} maxLength={200} disabled={busy} onChange={e=>setReference(e.target.value)}/></label><label className="factory-confirm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/><span>{tx('reviewConfirmed')}</span></label></>:<p role="status">{tx('reviewDenied')}</p>}</>:
 worker?<><h2>{tx('ownWorkerTitle')}</h2><p>{tx('workerCodeHint')}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();void act('claim-worker',{code:code.trim()})}}>
 <label className="field-label">{tx('code')}<input value={code} autoComplete="off" maxLength={64} required disabled={busy} onChange={e=>setCode(e.target.value)}/></label><button className="button button--primary button--full" disabled={busy||!/^[0-9a-f]{64}$/.test(code.trim())}>{tx('claimWorker')}</button></form></>:
 !organizationId?<>
 {!context.requests.length&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('submit',{name:name.trim(),nip,siteName:siteName.trim(),confirmed})}}>
 <label className="field-label">{tx('name')}<input value={name} required maxLength={120} autoComplete="organization" disabled={busy} onChange={e=>setName(e.target.value)}/></label>
 <label className="field-label">NIP<input value={nip} required pattern="[0-9]{10}" inputMode="numeric" maxLength={10} disabled={busy} onChange={e=>setNip(e.target.value)}/></label>
 <label className="field-label">{tx('firstSite')}<input value={siteName} required maxLength={120} disabled={busy} onChange={e=>setSiteName(e.target.value)}/></label>
 <label className="factory-confirm"><input type="checkbox" checked={confirmed} required disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>{tx('declaration')}</span></label>
 <button className="button button--primary button--full" disabled={busy||!name.trim()||!siteName.trim()||!confirmed||!/^\d{10}$/.test(nip)}>{tx('submit')}</button></form>}
 <p>{tx('agencyInviteHint')}</p></>:null}
 {(!organizationId||review)&&!worker&&context.requests.map(r=><article className="notice-box" key={r.id}><h3>{r.name}</h3><p>NIP: {r.nip} · {r.siteName}</p><strong data-testid="factory-registration-status">{tx(r.state)}</strong><p>{tx(r.state+'Hint')}</p>
 {!review&&r.state==='approved'&&<><Link className="button button--primary button--full" to={'/workspace/'+r.organizationId}>{tx('workspace')}</Link><Link to={'/workspace/'+r.organizationId+'/setup'+(code?'#agencyInvite='+encodeURIComponent(code):'')}>{tx('teamAndConnections')}</Link></>}
 {review&&context.reviewer&&r.state==='pending'&&<><button className="button button--primary button--full" disabled={busy||!reviewed||!reference.trim()} onClick={()=>void act('review',{id:r.id,decision:'approved',reference:reference.trim(),confirmed:reviewed})}>{tx('approve')}</button><button className="button button--outline button--full" disabled={busy||!reviewed||!reference.trim()} onClick={()=>void act('review',{id:r.id,decision:'rejected',reference:reference.trim(),confirmed:reviewed})}>{tx('reject')}</button></>}</article>)}
 {admin?.kind==='factory'&&<><h2>{tx('ownTeam')}</h2><p>{tx('ownTeamHint')}</p>{chooseSite}
 <form className="auth-form" onSubmit={e=>{e.preventDefault();void act('invite-worker',{worksiteId:site,startsAt:start+'T00:00:00.000Z'})}}>
 <label className="field-label">{tx('starts')}<input type="date" value={start} required disabled={busy} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></label><button className="button button--primary button--full" disabled={busy||!site||!/^\d{4}-\d{2}-\d{2}$/.test(start)}>{tx('inviteWorker')}</button></form>
 <h3>{tx('agencyInvite')}</h3><p>{tx('agencyInviteHint')}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();void act('claim-agency-invitation',{worksiteId:site,code:code.trim()})}}>
 <label className="field-label">{tx('agencyCode')}<input value={code} maxLength={64} autoComplete="off" disabled={busy} onChange={e=>setCode(e.target.value)}/></label><button className="button button--outline button--full" disabled={busy||!site||!/^[0-9a-f]{64}$/.test(code.trim())}>{tx('requestConnection')}</button></form>
 {context.workerInvitations.filter(v=>v.factoryId===organizationId).map(v=><article className="notice-box" key={v.id}><p>{sites.find(s=>s.id===v.worksiteId)?.name} · {tx(v.state==='pending'?'invitationPending':v.state)}</p>{v.membershipId&&<code>{v.membershipId}</code>}<p>{tx('starts')}: {new Date(v.startsAt).toLocaleDateString()}</p>{['pending','claimed'].includes(v.state)&&<button className="button button--outline button--full" disabled={busy} onClick={()=>void act('revoke-worker',{id:v.id})}>{tx('revokeWorker')}</button>}</article>)}
 <p className="muted-copy">{tx('hoursNext')}</p><p className="muted-copy">{tx('billingNext')}</p></>}
 {admin?.kind==='agency'&&<details className="enrollment-disclosure"><summary>{tx('inviteFactory')}</summary><p>{tx('agencyInviteHint')}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();void act('invite-factory',{agencyId:organizationId,factoryNip})}}>
 <label className="field-label">{tx('factoryNip')}<input value={factoryNip} required inputMode="numeric" maxLength={10} disabled={busy} onChange={e=>setFactoryNip(e.target.value)}/></label><button className="button button--outline button--full" disabled={busy||!/^\d{10}$/.test(factoryNip)}>{tx('createInvite')}</button></form>
 {context.agencyInvitations.filter(v=>v.agencyId===organizationId).map(v=><p key={v.id}>NIP {v.factoryNip} · {tx(v.state==='pending'?'invitationPending':v.state)} {v.state==='pending'&&<button disabled={busy} onClick={()=>void act('revoke-agency-invitation',{id:v.id})}>{tx('revokeInvite')}</button>}</p>)}</details>}
 {invite&&<div className="notice-box"><p>{tx('expires')}: {new Date(invite.expiresAt).toLocaleString()}</p><label className="field-label">{tx('code')}<textarea readOnly rows={3} value={invite.code}/></label><label className="field-label">{tx('link')}<textarea readOnly rows={4} value={location.origin+(invite.worker?'/factory/team/join#factoryWorker=':'/register/factory#agencyInvite=')+invite.code}/></label><p>{tx('noEmail')}</p></div>}
 {context.reviewer&&!review&&<Link to="/factory/review">{tx('reviewTitle')}</Link>}
 {worker&&setup.memberships.filter(m=>m.kind==='factory'&&m.role==='worker').map(m=><p key={m.id}><Link to={'/workspace/'+m.organizationId}>{tx('workspace')}: {m.name}</Link></p>)}
 {code&&!organizationId&&!worker&&<p className="notice-box">{tx('invitationAfterReview')}</p>}
 </>}
 {notice&&<p role={notice==='saved'?'status':'alert'}>{tx(notice)}</p>}
 <button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={()=>setRefresh(n=>n+1)}>{t('workerEnrollment.refresh')}</button>
 </section>;
}
