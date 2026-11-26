import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {TopBar} from '../../components/TopBar';
import {StagingSessionPanel} from '../auth/pages/StagingSessionPanel';
import {createFactoryClient,FactoryError} from './factory-client';
import '../../styles/membership-hours.css';
type Application={id:string;legalName:string;nip:string;state:'pending'|'approved'|'rejected';factoryId?:string;email?:string;representationNote?:string;reviewReference?:string;reason?:string;canReview?:boolean};
type Connection={id:string;factoryId:string;factoryName:string;agencyId:string;agencyName:string;state:'pending'|'active'|'declined'|'cancelled';canRespond:boolean;canCancel:boolean};
type Context={localOnly:true;csrf:string;applications:Application[];factories?:{id:string;name:string;nip?:string}[];agencies?:{id:string;name:string;nip:string}[];connections?:Connection[];reviewer?:boolean};
export function FactoryOnboardingPage({section}:{section:'applicant'|'review'|'connections'}){
 const {t}=useTranslation(),tx=(k:string)=>t('factoryOnboarding.'+k);
 const api=useMemo(()=>createFactoryClient(import.meta.env.MODE,location.origin,window.fetch.bind(window)),[]);
 const [ctx,setCtx]=useState<Context>(),[reload,setReload]=useState(0),[notice,setNotice]=useState('checking'),[busy,setBusy]=useState(false);
 const [legalName,setLegalName]=useState(''),[nip,setNip]=useState(''),[note,setNote]=useState(''),[factoryId,setFactoryId]=useState(''),[agencyNip,setAgencyNip]=useState('');
 const [reviews,setReviews]=useState<Record<string,{confirmed?:boolean;reference?:string;reason?:string}>>({}),[consents,setConsents]=useState<Record<string,boolean>>({});
 const mounted=useRef(false),operation=useRef<AbortController|null>(null);
 const refresh=useCallback(()=>{setCtx(undefined);setReload(x=>x+1)},[]);
 const route=section==='review'?'/onboarding/review/context':'/onboarding/context';
 async function load(signal:AbortSignal){if(!api)throw new FactoryError(403,'closed');const v=await api.request<Context>(route,signal);
  if(v.localOnly!==true||typeof v.csrf!=='string'||!Array.isArray(v.applications)||section==='review'&&v.reviewer!==true)throw new FactoryError(503,'unavailable');return v;
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort()}},[]);
 useEffect(()=>{const c=new AbortController();setNotice('checking');void load(c.signal).then(v=>{if(!c.signal.aborted){setCtx(v);setNotice('ready')}}).catch(e=>{if(!c.signal.aborted){setCtx(undefined);setNotice(e instanceof FactoryError?e.message:'unavailable')}});return()=>c.abort()},[api,reload,section]);
 async function act(action:string,input:object){if(!api||!ctx||operation.current)return;const c=new AbortController();operation.current=c;setBusy(true);
  try{await api.request('/onboarding/'+action,c.signal,input,ctx.csrf);const v=await load(c.signal);if(!c.signal.aborted&&mounted.current){setCtx(v);setNotice('saved')}}
  catch(e){if(!c.signal.aborted&&mounted.current){setNotice(e instanceof FactoryError?e.message:'unavailable');if(e instanceof FactoryError&&e.status===403)setCtx(undefined)}}
  finally{if(operation.current===c)operation.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false)}
 }
 return <><TopBar/><main className="membership-main"><section className="membership-card"><h1>{tx(section+'Title')}</h1><p>{tx('local')}</p>
  <StagingSessionPanel purpose="existing" audience="workspace" onChanged={refresh}/><p role="status">{tx(notice)}</p>
  <button className="button button--outline" disabled={busy} onClick={refresh}>{t('localWorkspace.refresh')}</button>
  {!!ctx?.factories?.length&&<nav className="factory-links"><Link to="/factory/assignments">{t("factoryPlacement.factoryTitle")}</Link><Link to="/factory/leaders">{t('leaderAccess.manage')}</Link><Link to="/factory/connections">{tx('connectionsTitle')}</Link></nav>}
 </section>
 {ctx&&section==='applicant'&&<section className="membership-card"><p>{tx('reviewRequired')}</p>
  <form className="auth-form" onSubmit={e=>{e.preventDefault();void act('applications',{legalName:legalName.trim(),nip:nip.trim(),representationNote:note.trim()})}}>
   <label className="field-label"><span>{tx('legalName')}</span><input id="factory-legal-name" required minLength={2} maxLength={120} disabled={busy} value={legalName} onChange={e=>setLegalName(e.target.value)}/></label>
   <label className="field-label"><span>NIP</span><input id="factory-nip" required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} disabled={busy} value={nip} onChange={e=>setNip(e.target.value)}/></label>
   <label className="field-label"><span>{tx('representation')}</span><textarea id="factory-representation" required minLength={10} maxLength={1000} disabled={busy} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <button className="button button--primary" disabled={busy}>{tx('submit')}</button>
  </form>
  {ctx.applications.map(a=><article className="membership-record" key={a.id}><h2>{a.legalName}</h2><p>NIP: {a.nip} · {tx(a.state)}</p>{a.reason&&<p>{a.reason}</p>}{a.state==='approved'&&<Link to="/factory/leaders">{tx('openAdmin')}</Link>}</article>)}
 </section>}
 {ctx&&section==='review'&&<section className="membership-card"><p>{tx('reviewerScope')}</p>{!ctx.applications.length&&<p>{t('localWorkspace.empty')}</p>}
  {ctx.applications.map(a=>{const v=reviews[a.id]??{};const update=(x:typeof v)=>setReviews(old=>({...old,[a.id]:{...v,...x}}));return <article className="membership-record" key={a.id}>
   <h2>{a.legalName}</h2><p>NIP: {a.nip} · {a.email} · {tx(a.state)}</p><p>{a.representationNote}</p>{a.reviewReference&&<p>{tx('reviewReference')}: {a.reviewReference}</p>}{a.reason&&<p>{a.reason}</p>}
   {a.canReview&&<><label className="checkbox-field"><input type="checkbox" disabled={busy} checked={v.confirmed??false} onChange={e=>update({confirmed:e.target.checked})}/><span>{tx('confirmRepresentation')}</span></label>
    <label className="field-label"><span>{tx('reviewReference')}</span><input minLength={6} maxLength={200} disabled={busy} value={v.reference??''} onChange={e=>update({reference:e.target.value})}/></label>
    <button className="button button--primary" disabled={busy||!v.confirmed||(v.reference?.trim().length??0)<6} onClick={()=>void act('review/approve',{id:a.id,confirmRepresentation:true,reviewReference:v.reference!.trim()})}>{tx('approve')}</button>
    <label className="field-label"><span>{tx('reason')}</span><textarea maxLength={500} disabled={busy} value={v.reason??''} onChange={e=>update({reason:e.target.value})}/></label>
    <button className="button button--outline" disabled={busy||(v.reason?.trim().length??0)<2} onClick={()=>void act('review/reject',{id:a.id,reason:v.reason!.trim()})}>{tx('reject')}</button>
   </>}
  </article>})}
 </section>}
 {ctx&&section==='connections'&&<section className="membership-card"><p>{tx('connectionScope')}</p>
  {!!ctx.factories?.length&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('connections/request',{factoryId,agencyNip:agencyNip.trim()})}}>
   <label className="field-label"><span>{t('connectedFactory.factory')}</span><select id="connection-factory" required disabled={busy} value={factoryId} onChange={e=>setFactoryId(e.target.value)}><option value="">{t('leaderAccess.select')}</option>{ctx.factories.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
   <label className="field-label"><span>{tx('agencyNip')}</span><input id="connection-nip" required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} disabled={busy} value={agencyNip} onChange={e=>setAgencyNip(e.target.value)}/></label>
   <button className="button button--primary" disabled={busy||!factoryId}>{tx('requestConnection')}</button>
  </form>}
  {!ctx.connections?.length&&<p>{t('localWorkspace.empty')}</p>}
  {ctx.connections?.map(c=><article className="membership-record" key={c.id}><h2>{c.factoryName}</h2><p>{c.agencyName} · {tx(c.state)}</p>
   {c.canRespond&&<><label className="checkbox-field"><input type="checkbox" disabled={busy} checked={consents[c.id]??false} onChange={e=>setConsents(old=>({...old,[c.id]:e.target.checked}))}/><span>{tx('confirmConnection')}</span></label>
    <button className="button button--primary" disabled={busy||!consents[c.id]} onClick={()=>void act('connections/accept',{id:c.id,confirmed:true})}>{tx('acceptConnection')}</button>
    <button className="button button--outline" disabled={busy} onClick={()=>void act('connections/decline',{id:c.id})}>{tx('declineConnection')}</button></>}
   {c.canCancel&&<button className="button button--outline" disabled={busy} onClick={()=>void act('connections/cancel',{id:c.id})}>{tx('cancelConnection')}</button>}
  </article>)}
 </section>}
 </main></>;
}
