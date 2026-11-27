import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {LanguageSwitcher} from '../components/LanguageSwitcher';
import {ThemeToggle} from '../components/ThemeToggle';
import {getProductionCopy} from './agency-production-copy';

type Fields={name:string;address:string;contactEmail:string};
type Profile=Fields&{organizationId:string;nip:string|null;nipVerified:boolean;email:string|null};
export function AgencyProfile({organizationId,onSaved}:{organizationId:string;onSaved:(name:string)=>void}){
 const {t,i18n}=useTranslation(),tx=(key:string)=>t('agencySettings.'+key),copy=getProductionCopy(i18n.resolvedLanguage);
 const [profile,setProfile]=useState<Profile>(),[draft,setDraft]=useState<Fields>({name:'',address:'',contactEmail:''});
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[attempt,retry]=useState(0);
 const submitting=useRef(false);
 const url='/api/agency-profile/'+organizationId;
 useEffect(()=>{
  const c=new AbortController();setProfile(undefined);setStatus('');
  void fetch(url+'/context',{signal:c.signal,credentials:'same-origin',cache:'no-store',redirect:'error'}).then(r=>{
   if(!r.ok)throw Error();return r.json() as Promise<Profile>;
  }).then(p=>{if(!c.signal.aborted){if(p.organizationId!==organizationId)throw Error();setProfile(p);setDraft(p)}}).catch(()=>{if(!c.signal.aborted)setStatus('error')});
  return()=>c.abort();
 },[organizationId,url,attempt]);
 const changed=!!profile&&(draft.name.trim()!==profile.name||draft.address.trim()!==profile.address||draft.contactEmail.trim()!==profile.contactEmail);
 function set(key:keyof Fields,value:string){setDraft(v=>({...v,[key]:value}));setStatus('')}
 async function save(){
  if(submitting.current||!profile||draft.name.trim().length<2||!changed)return;
  submitting.current=true;setBusy(true);setStatus('');
  try{
   const r=await fetch(url+'/settings',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({name:draft.name,address:draft.address,contactEmail:draft.contactEmail})});
   if(!r.ok)throw Error();
   const p=await r.json() as Profile;
   if(p.organizationId!==organizationId)throw Error();
   setProfile(p);setDraft(p);onSaved(p.name);setStatus('saved');
  }catch{setStatus('error')}finally{setBusy(false);submitting.current=false}
 }
 return <>
  <section className="dashboard-panel" aria-busy={busy||!profile&&!status}>
   <h2>{copy.agencyDetails}</h2>
   {!profile&&!status&&<p role="status">{t('workspaceRead.checking')}</p>}
   {profile&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void save()}}>
    <label className="field-label">{tx('name')}<input autoComplete="organization" required minLength={2} maxLength={120} value={draft.name} onChange={e=>set('name',e.target.value)} disabled={busy}/></label>
    <label className="field-label">{copy.agencyAddress}<input autoComplete="street-address" maxLength={240} value={draft.address} onChange={e=>set('address',e.target.value)} disabled={busy}/></label>
    <label className="field-label">{copy.contactEmail}<input type="email" autoComplete="email" maxLength={254} value={draft.contactEmail} onChange={e=>set('contactEmail',e.target.value)} disabled={busy}/></label>
    <p className="muted-copy">{copy.contactHint}</p>
    <dl><dt>NIP</dt><dd>{profile.nip??'-'} {profile.nip&&tx(profile.nipVerified?'nipVerified':'nipClaimed')}</dd>{profile.email&&<><dt>{tx('email')}</dt><dd>{profile.email}</dd></>}</dl>
    <button className="button button--primary" disabled={busy||draft.name.trim().length<2||!changed}>{tx('save')}</button>
   </form>}
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
