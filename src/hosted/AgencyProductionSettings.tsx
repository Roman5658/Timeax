import {useEffect,useId,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {getProductionCopy,getTimePlanCopy,plannedModes,type PlannedTimeMode} from './agency-production-copy';

type Fields={name:string;address:string;description:string};
type SitePreferences=Fields&{organizationId:string;worksiteId:string;connected:boolean;plannedTimeMode:PlannedTimeMode|null};
const internalEntryCopy={ru:'Ручной режим разрешает назначенным работникам записывать свои смены. Во всех остальных режимах ручной ввод закрыт.',pl:'Tryb ręczny pozwala przypisanym pracownikom zapisywać własne zmiany. W pozostałych trybach nie można wpisywać zmian ręcznie.',uk:'Ручний режим дозволяє призначеним працівникам записувати свої зміни. В інших режимах ручне введення вимкнено.',en:'Manual mode lets assigned workers record their own shifts. Other modes disable manual entry.'};
export function AgencyProductionSettings({organizationId,worksiteId,connected,form,suspended,onSaved,onBusy}:{
 organizationId:string;worksiteId:string;connected:boolean;form:boolean;suspended?:boolean;
 onSaved:(name:string)=>void;onBusy:(busy:boolean)=>void;
}){
 const {t,i18n}=useTranslation(),copy=getProductionCopy(i18n.resolvedLanguage);
 const modeCopy=getTimePlanCopy(i18n.resolvedLanguage),modeId=useId();
 const language=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof internalEntryCopy;
 const modeHint=connected?modeCopy.lead:(internalEntryCopy[language]??internalEntryCopy.en);
 const [mode,setMode]=useState<PlannedTimeMode|null>(null),[modeStatus,setModeStatus]=useState('');
 const [settings,setSettings]=useState<SitePreferences>(),[draft,setDraft]=useState<Fields>({name:'',address:'',description:''});
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[attempt,retry]=useState(0);
 const submitting=useRef(false);
 const url='/api/agency-profile/'+organizationId+'/worksite/'+worksiteId;
 function verify(p:SitePreferences){
  if(p.organizationId!==organizationId||p.worksiteId!==worksiteId||p.connected!==connected||
   typeof p.name!=='string'||typeof p.address!=='string'||typeof p.description!=='string'||
   p.plannedTimeMode!==null&&!plannedModes.includes(p.plannedTimeMode))throw Error();
  return p;
 }
 useEffect(()=>{
  const c=new AbortController();setSettings(undefined);setStatus('');setModeStatus('');
  void fetch(url+'/context',{signal:c.signal,credentials:'same-origin',cache:'no-store',redirect:'error'}).then(async r=>{
   if(!r.ok)throw Error();return verify(await r.json());
  }).then(p=>{if(!c.signal.aborted){setSettings(p);setDraft(p);setMode(p.plannedTimeMode)}}).catch(()=>{if(!c.signal.aborted)setStatus('error')});
  return()=>c.abort();
 },[url,attempt,connected]);
 const changed=!!settings&&(['name','address','description'] as const).some(key=>draft[key].trim()!==settings[key]);
 function set(key:keyof Fields,value:string){setDraft(v=>({...v,[key]:value}));setStatus('')}
 async function save(){
  if(submitting.current||suspended||!settings||!changed||!connected&&!draft.name.trim())return;
  submitting.current=true;setBusy(true);onBusy(true);setStatus('');
  try{
   const r=await fetch(url+'/settings',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({name:draft.name,address:draft.address,description:draft.description})});
   if(!r.ok)throw Error();
   const p=verify(await r.json());
   setSettings(p);setDraft(p);onSaved(p.name);setStatus('saved');
  }catch{setStatus('error')}finally{setBusy(false);onBusy(false);submitting.current=false}
 }
 async function savePlan(){
  if(submitting.current||suspended||!settings||mode===settings.plannedTimeMode)return;
  submitting.current=true;setBusy(true);onBusy(true);setModeStatus('');
  try{
   const r=await fetch(url+'/settings',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({plannedTimeMode:mode})});
   if(!r.ok)throw Error();
   const p=verify(await r.json());
   if(p.plannedTimeMode!==mode)throw Error();
   setSettings(p);setMode(p.plannedTimeMode);setModeStatus('saved');
  }catch{setModeStatus('error')}finally{setBusy(false);onBusy(false);submitting.current=false}
 }
 if(!settings)return status==='error'
  ? <p role="alert">{copy.settingsError} <button className="button button--outline" type="button" onClick={()=>retry(v=>v+1)}>{copy.retry}</button></p>
  : <p role="status">{t('workspaceRead.checking')}</p>;
 if(!form)return settings.name&&connected||settings.address||settings.description||settings.plannedTimeMode?<dl className="notice-box">
  {settings.name&&connected&&<><dt>{copy.internalAlias}</dt><dd>{settings.name}</dd></>}
  {settings.address&&<><dt>{t('workflow.production.address')}</dt><dd>{settings.address}</dd></>}
  {settings.description&&<><dt>{t('workflow.production.description')}</dt><dd className="agency-site-description">{settings.description}</dd></>}
  {settings.plannedTimeMode&&<><dt>{modeCopy.title}</dt><dd>{modeCopy[settings.plannedTimeMode]}</dd><dd>{modeHint}</dd></>}
 </dl>:null;
 return <><form className="auth-form notice-box" onSubmit={e=>{e.preventDefault();void save()}} aria-busy={busy}>
  {connected&&<p className="muted-copy">{copy.connectedSettingsHint}</p>}
  <label className="field-label">{connected?copy.internalAlias:t('factoryEnrollment.siteName')}<input required={!connected} maxLength={120} value={draft.name} onChange={e=>set('name',e.target.value)} disabled={busy||suspended}/></label>
  <label className="field-label">{t('workflow.production.address')}<input maxLength={240} value={draft.address} onChange={e=>set('address',e.target.value)} disabled={busy||suspended}/></label>
  <label className="field-label">{t('workflow.production.description')}<textarea rows={4} maxLength={1500} value={draft.description} onChange={e=>set('description',e.target.value)} disabled={busy||suspended}/></label>
  <button className="button button--primary" disabled={busy||suspended||!changed||!connected&&!draft.name.trim()}>{t('common.save')}</button>
  {status&&<p role={status==='error'?'alert':'status'}>{status==='saved'?copy.settingsSaved:copy.settingsError}</p>}
 </form>
 <form className="auth-form notice-box" aria-busy={busy} onSubmit={e=>{e.preventDefault();void savePlan()}}>
  <fieldset disabled={busy||suspended} aria-describedby={modeId+'-hint'}>
   <legend>{modeCopy.title}</legend>
   <p id={modeId+'-hint'} className="muted-copy">{modeHint}{connected&&<> {modeCopy.tenant}</>}</p>
   <div className="permission-checks">
    {plannedModes.map(option=><label className="checkbox-field" key={option}>
     <input type="radio" name={modeId} value={option} checked={option===mode} onChange={()=>{setMode(option);setModeStatus('')}}/>
     <span>{modeCopy[option]}<br/><small>{modeCopy[(option+'_hint') as keyof typeof modeCopy]}</small></span>
    </label>)}
   </div>
  </fieldset>
  {mode===null&&<small>{modeCopy.none}</small>}
  <div className="form-actions">
   <button className="button button--primary" disabled={busy||suspended||mode===settings.plannedTimeMode}>{modeCopy.save}</button>
   {mode!==null&&<button className="button button--outline" type="button" disabled={busy||suspended} onClick={()=>{setMode(null);setModeStatus('')}}>{modeCopy.clear}</button>}
  </div>
  {modeStatus&&<p role={modeStatus==='error'?'alert':'status'}>{modeStatus==='saved'?modeCopy.saved:copy.settingsError}</p>}
 </form></>;
}
