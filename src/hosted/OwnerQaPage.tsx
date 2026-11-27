import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';
import {isWorkerLocal} from './worker-enrollment';
type Account={id:string;label:string;organizationLabel:string;state:string};
type Context={state:'owner';qaScope:string;accounts:Account[];cleanupEnabled:true;cleanupMode:'end-marked-worker-membership'};
type Preview={previewId:string;id:string;label:string;organizationLabel:string;expiresAt:string;assignments:number};
async function call(path:string,body?:unknown,signal?:AbortSignal){
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('closed');
 const r=await fetch('/api/owner-qa/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
  headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'changed':'closed');
 return r.json();
}
export function OwnerQaLink({revision=0}:{revision?:number}){
 const {t}=useTranslation(),[allowed,setAllowed]=useState(false);
 useEffect(()=>{const c=new AbortController();setAllowed(false);void call('context',undefined,c.signal).then(v=>{if(!c.signal.aborted)setAllowed(v.state==='owner'&&v.cleanupEnabled===true)}).catch(()=>{});return()=>c.abort()},[revision]);
 return allowed?<Link className="button button--outline" to="/super-admin/qa">{t('ownerQa.title')}</Link>:null;
}
export function OwnerQaPage(){
 const {t}=useTranslation(),[state,setState]=useState('checking'),[context,setContext]=useState<Context|null>(null),[preview,setPreview]=useState<Preview|null>(null),
 [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[receipt,setReceipt]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const v=await call('context',undefined,signal) as Context;if(v.state!=='owner'||v.cleanupEnabled!==true||v.cleanupMode!=='end-marked-worker-membership'||!Array.isArray(v.accounts))throw Error('closed');
   if(!signal?.aborted){setContext(v);setState('owner')}
  }catch(e){if(!signal?.aborted){setContext(null);setPreview(null);setState(e instanceof Error&&['login','denied'].includes(e.message)?e.message:'closed')}}
 },[]);
 useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>c.abort()},[load]);
 async function prepare(id:string){
  setBusy(true);setNotice('');setReceipt('');setPreview(null);setConfirmation('');
  try{const v=await call('preview',{id}) as Preview;if(typeof v.previewId!=='string'||v.id!==id)throw Error('closed');setPreview(v)}
  catch(e){setNotice(e instanceof Error&&e.message==='changed'?'changed':'failed');if(e instanceof Error&&['login','denied'].includes(e.message))await load()}
  finally{setBusy(false)}
 }
 async function finish(){
  if(!preview||confirmation!=='END MEMBERSHIP')return;
  setBusy(true);setNotice('');
  try{const v=await call('cleanup',{previewId:preview.previewId,confirmation:'END QA MEMBERSHIP'});if(v.state!=='ended'||v.providerIdentityDeleted!==false||v.documentsPreserved!==true)throw Error('closed');
   setReceipt(v.receiptId);setPreview(null);setConfirmation('');await load();
  }catch(e){setNotice(e instanceof Error&&e.message==='changed'?'changed':'uncertain');if(e instanceof Error&&['login','denied'].includes(e.message))await load()}
  finally{setBusy(false)}
 }
 return <RegistrationFrame title={t('ownerQa.title')} lead={t('ownerQa.scope')}>
  <p role="status">{t('ownerQa.'+state)}</p>
  {context&&<><p className="notice-box">{t('ownerQa.preserve')}</p>
   <ul>{context.accounts.map(v=><li key={v.id} style={{marginBottom:16,overflowWrap:'anywhere'}}>
    <strong>{v.label}</strong> · {v.organizationLabel}<p>{t('ownerQa.'+(v.state==='active'?'active':'ended'))}</p>
    {v.state==='active'&&<button className="button button--outline" disabled={busy} onClick={()=>void prepare(v.id)} aria-label={t('ownerQa.previewFor',{name:v.label})}>{t('ownerQa.preview')}</button>}
   </li>)}</ul>{context.accounts.length===0&&<p>{t('ownerQa.empty')}</p>}
  </>}
  {preview&&<form className="auth-form notice-box" onSubmit={e=>{e.preventDefault();void finish()}} aria-busy={busy}>
   <h2>{t('ownerQa.confirmTitle')}</h2><p><strong>{preview.label}</strong> · {preview.organizationLabel}</p>
   <p>{t('ownerQa.assignments',{count:preview.assignments})}</p><p>{t('ownerQa.preserve')}</p>
   <label className="field-label"><span>{t('ownerQa.typeConfirmation')}</span><input value={confirmation} disabled={busy} autoComplete="off" maxLength={30} onChange={e=>setConfirmation(e.target.value)}/></label>
   <button className="button button--primary" disabled={busy||confirmation!=='END MEMBERSHIP'}>{t('ownerQa.end')}</button>
   <button type="button" className="button button--outline" disabled={busy} onClick={()=>{setPreview(null);setConfirmation('');setNotice('')}}>{t('ownerQa.cancel')}</button>
  </form>}
  {notice&&<p role="alert">{t('ownerQa.'+notice)}</p>}
  {receipt&&<p role="status" style={{overflowWrap:'anywhere'}}>{t('ownerQa.completed')} {receipt}</p>}
  {!context&&<p className="notice-box">{t('ownerQa.cleanupClosed')}</p>}
  <button className="button button--outline" disabled={busy||state==='checking'} onClick={()=>void load()}>{t('ownerQa.refresh')}</button>
  <Link className="button button--outline" to="/login">{t('ownerQa.loginLink')}</Link>
 </RegistrationFrame>;
}
