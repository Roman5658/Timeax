import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {independenceCall,parseFactoryLookup,parseFactoryInvitation} from './factory-independence';

const normalize=(value:string)=>value.replace(/[\s-]/g,'');
const validNip=(value:string)=>/^\d{10}$/.test(value)&&[6,5,7,2,3,4,5,6,7].reduce((sum,weight,i)=>sum+Number(value[i])*weight,0)%11===Number(value[9]);

export function AgencyFactoryConnect({organizationId,onIssued}:{organizationId:string;onIssued:()=>void}){
 const {t,i18n}=useTranslation(),tx=(key:string)=>t('agencyFactoryConnect.'+key);
 const [open,setOpen]=useState(false),[nip,setNip]=useState(''),[name,setName]=useState(''),[address,setAddress]=useState('');
 const [found,setFound]=useState<ReturnType<typeof parseFactoryLookup>>(),[invite,setInvite]=useState<ReturnType<typeof parseFactoryInvitation>>();
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false);
 const factoryNip=normalize(nip);
 const url=invite?location.origin+'/register/factory#agencyInvite='+invite.code:'';
 function reset(){setFound(undefined);setInvite(undefined);setNotice('');setName('');setAddress('')}
 async function submit(){
  if(pending.current)return;
  if(!validNip(factoryNip)){setNotice('badNip');return}
  pending.current=true;setBusy(true);setNotice('');
  try{
   if(!found){
    const data=parseFactoryLookup(await independenceCall('lookup-factory',{agencyId:organizationId,factoryNip}));
    setFound(data);
    if(data.state==='registered'){setName(data.name);setAddress(data.address??'')}
   }else{
    const data=parseFactoryInvitation(await independenceCall('prepare-factory',{agencyId:organizationId,factoryNip,name:name.trim(),address:address.trim()}));
    setInvite(data);onIssued();
   }
  }catch{setNotice('failed')}finally{pending.current=false;setBusy(false)}
 }
 return <>
  <button type="button" className="button button--primary" onClick={()=>setOpen(true)}>{tx('title')}</button>
  {open&&<AgencyBookDrawer title={tx('title')} closeLabel={t('common.close')} busy={busy} onClose={()=>setOpen(false)}>
   {!invite?<form className="auth-form" onSubmit={event=>{event.preventDefault();void submit()}}>
    <label className="field-label">NIP<input required autoComplete="off" inputMode="numeric" maxLength={20} value={nip} disabled={busy} onChange={event=>{setNip(event.currentTarget.value);reset()}}/></label>
    {found&&<>
     <p role="status">{tx(found.state==='registered'?'found':'notFound')}</p>
     <label className="field-label">{tx('name')}<input autoComplete="organization" required readOnly={found.state==='registered'} disabled={busy} maxLength={120} value={name} onChange={event=>setName(event.currentTarget.value)}/></label>
     <label className="field-label">{tx('address')}<input autoComplete="street-address" required disabled={busy} maxLength={200} value={address} onChange={event=>setAddress(event.currentTarget.value)}/></label>
    </>}
    <button className="button button--primary" disabled={busy||!factoryNip||!!found&&(!name.trim()||!address.trim())}>{tx(found?'create':'find')}</button>
   </form>:<div className="notice-box">
    <p>{tx('share')}</p><p>{t('factoryIndependent.expires')}: {new Date(invite.expiresAt).toLocaleString(i18n.resolvedLanguage)}</p>
    <label className="field-label">{t('factoryIndependent.link')}<input readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label>
    <div className="form-actions"><button type="button" className="button button--primary" onClick={()=>{if(!navigator.clipboard){setNotice('copyManually');return}void navigator.clipboard.writeText(url).then(()=>setNotice('copied'),()=>setNotice('copyManually'))}}>{tx('copy')}</button><button type="button" className="button button--outline" onClick={()=>{setNip('');reset()}}>{tx('another')}</button></div>
   </div>}
   {notice&&<p role={notice==='copied'?'status':'alert'}>{tx(notice)}</p>}
  </AgencyBookDrawer>}
 </>;
}
