import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {LanguageSwitcher} from '../components/LanguageSwitcher';
import {ThemeToggle} from '../components/ThemeToggle';
import {getProductionCopy} from './agency-production-copy';
import './agency-profile.css';

type Fields={name:string;address:string;contactEmail:string};
type Profile=Fields&{organizationId:string;nip:string|null;nipVerified:boolean;email:string|null};
const fieldKeys=['name','address','contactEmail'] as const;
function parseProfile(raw:unknown,organizationId:string):Profile{
 const p=raw as Profile|null;
 if(!p||p.organizationId!==organizationId||fieldKeys.some(k=>typeof p[k]!=='string')||typeof p.nipVerified!=='boolean'||
   p.nip!==null&&(typeof p.nip!=='string'||!/^\d{10}$/.test(p.nip))||p.email!==null&&typeof p.email!=='string')throw Error();
 return p;
}
export function AgencyProfile({organizationId,onSaved}:{organizationId:string;onSaved:(name:string)=>void}){
 const {t,i18n}=useTranslation(),tx=(key:string)=>t('agencySettings.'+key),copy=getProductionCopy(i18n.resolvedLanguage);
 const [profile,setProfile]=useState<Profile>(),[draft,setDraft]=useState<Fields>({name:'',address:'',contactEmail:''});
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[attempt,retry]=useState(0),[editing,setEditing]=useState(false);
 const submitting=useRef(false);
 const firstField=useRef<HTMLInputElement>(null),editButton=useRef<HTMLButtonElement>(null),focusTarget=useRef<'input'|'edit'|undefined>(undefined);
 const url='/api/agency-profile/'+organizationId;
 useEffect(()=>{
  const c=new AbortController();setProfile(undefined);setStatus('');setEditing(false);
  void fetch(url+'/context',{signal:c.signal,credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>{
   if(!r.ok)throw Error();return parseProfile(await r.json(),organizationId);
  }).then(p=>{if(!c.signal.aborted){setProfile(p);setDraft(p)}}).catch(()=>{if(!c.signal.aborted)setStatus('error')});
  return()=>c.abort();
 },[organizationId,url,attempt]);
 useEffect(()=>{
  const target=focusTarget.current;
  if(target==='input'&&editing)firstField.current?.focus();
  if(target==='edit'&&!editing)editButton.current?.focus();
  focusTarget.current=undefined;
 },[editing]);
 const changed=!!profile&&fieldKeys.some(k=>draft[k].trim()!==profile[k]);
 function set(key:keyof Fields,value:string){setDraft(v=>({...v,[key]:value}));setStatus('')}
 function changeEditing(next:boolean){
  if(profile)setDraft(profile);
  focusTarget.current=next?'input':'edit';
  setEditing(next);setStatus('');
 }
 async function save(){
  if(submitting.current||!profile||!editing||draft.name.trim().length<2||!changed)return;
  submitting.current=true;setBusy(true);setStatus('');
  try{
   const normalized={name:draft.name.trim(),address:draft.address.trim(),contactEmail:draft.contactEmail.trim()};
   const r=await fetch(url+'/settings',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(normalized)});
   if(!r.ok)throw Error();
   const p=parseProfile(await r.json(),organizationId);
   if(fieldKeys.some(k=>p[k]!==normalized[k]))throw Error();
   setProfile(p);setDraft(p);onSaved(p.name);focusTarget.current='edit';setEditing(false);setStatus('saved');
  }catch{setStatus('error')}finally{setBusy(false);submitting.current=false}
 }
 const identityDetails=profile&&<><div><dt>NIP</dt><dd>{profile.nip??'–'} {profile.nip&&tx(profile.nipVerified?'nipVerified':'nipClaimed')}</dd></div>
  {profile.email&&<div><dt>{tx('email')}</dt><dd>{profile.email}</dd></div>}</>;
 return <>
  <section className="dashboard-panel agency-profile-panel" aria-busy={busy||!profile&&!status}>
   <div className="agency-profile-heading"><h2>{copy.agencyDetails}</h2>
    {profile&&!editing&&<button type="button" className="button button--outline" ref={editButton} onClick={()=>changeEditing(true)}>{copy.editAgencyDetails}</button>}
   </div>
   {!profile&&!status&&<p role="status">{t('workspaceRead.checking')}</p>}
   {profile&&(editing?<form className="auth-form" onSubmit={e=>{e.preventDefault();void save()}}>
    <label className="field-label">{tx('name')}<input ref={firstField} autoComplete="organization" required minLength={2} maxLength={120} value={draft.name} onChange={e=>set('name',e.target.value)} disabled={busy}/></label>
    <label className="field-label">{copy.agencyAddress}<input autoComplete="street-address" maxLength={240} value={draft.address} onChange={e=>set('address',e.target.value)} disabled={busy}/></label>
    <label className="field-label">{copy.invoiceEmail}<input type="email" autoComplete="section-billing email" aria-describedby="agency-invoice-email-hint" maxLength={254} value={draft.contactEmail} onChange={e=>set('contactEmail',e.target.value)} disabled={busy}/></label>
    <p id="agency-invoice-email-hint" className="muted-copy">{copy.invoiceEmailHint}</p>
    <dl className="agency-profile-fields">{identityDetails}</dl>
    <div className="form-actions">
     <button className="button button--primary" disabled={busy||draft.name.trim().length<2||!changed}>{tx('save')}</button>
     <button className="button button--outline" type="button" disabled={busy} onClick={()=>changeEditing(false)}>{t('common.cancel')}</button>
    </div>
   </form>:<dl className="agency-profile-fields">
    <div><dt>{tx('name')}</dt><dd>{profile.name}</dd></div>
    <div><dt>{copy.agencyAddress}</dt><dd>{profile.address||'–'}</dd></div>
    <div><dt>{copy.invoiceEmail}</dt><dd>{profile.contactEmail||'–'}</dd></div>
    {identityDetails}
   </dl>)}
   {status&&<p role={status==='error'?'alert':'status'}>{tx(status)}</p>}
   {!profile&&status==='error'&&<button className="button button--outline" type="button" onClick={()=>retry(v=>v+1)}>{copy.retry}</button>}
  </section>
  <section className="dashboard-panel">
   <h2>{t('settings.languageTitle')}</h2>
   <LanguageSwitcher />
   <h2>{t('settings.themeTitle')}</h2>
   <ThemeToggle expanded />
  </section>
 </>;
}
