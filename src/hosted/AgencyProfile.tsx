import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';

type Profile={organizationId:string;name:string;nip:string|null;nipVerified:boolean;email:string|null};
export function AgencyProfile({organizationId,onSaved}:{organizationId:string;onSaved:(name:string)=>void}){
 const {t}=useTranslation(),tx=(key:string)=>t('agencySettings.'+key);
 const [profile,setProfile]=useState<Profile>(),[name,setName]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const submitting=useRef(false);
 const url='/api/agency-profile/'+organizationId;
 useEffect(()=>{
  const c=new AbortController();setProfile(undefined);setStatus('');
  void fetch(url+'/context',{signal:c.signal,credentials:'same-origin',cache:'no-store',redirect:'error'}).then(r=>{
   if(!r.ok)throw Error();return r.json() as Promise<Profile>;
  }).then(p=>{if(!c.signal.aborted&&p.organizationId===organizationId){setProfile(p);setName(p.name)}}).catch(()=>{if(!c.signal.aborted)setStatus('error')});
  return()=>c.abort();
 },[organizationId,url]);
 async function save(){
  if(submitting.current||!profile||name.trim().length<2||name.trim()===profile.name)return;
  submitting.current=true;setBusy(true);setStatus('');
  try{
   const r=await fetch(url+'/settings',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
   if(!r.ok)throw Error();
   const p=await r.json() as Profile;
   if(p.organizationId!==organizationId)throw Error();
   setProfile(p);setName(p.name);onSaved(p.name);setStatus('saved');
  }catch{setStatus('error')}finally{setBusy(false);submitting.current=false}
 }
 return <section className="dashboard-panel" aria-busy={busy||!profile&&!status}>
  {!profile&&!status&&<p role="status">{t('workspaceRead.checking')}</p>}
  {profile&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void save()}}>
   <label className="field-label">{tx('name')}<input autoComplete="organization" required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
   <dl><dt>NIP</dt><dd>{profile.nip??'–'} {profile.nip&&tx(profile.nipVerified?'nipVerified':'nipClaimed')}</dd>{profile.email&&<><dt>{tx('email')}</dt><dd>{profile.email}</dd></>}</dl>
   <button className="button button--primary" disabled={busy||name.trim().length<2||name.trim()===profile.name}>{tx('save')}</button>
  </form>}
  {status&&<p role={status==='error'?'alert':'status'}>{tx(status)}</p>}
 </section>;
}
