import {useEffect,useMemo,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {factoryCall} from './factory-enrollment';
import {factoryRoleCopy} from './factory-role-copy';
import {parseFactoryRoster,parseFactorySchedule,validFactoryPeriod,type FactoryRoster,type FactoryRosterUnit} from './factory-organization';
import {useMemberNames} from './MemberNames';
import {workerLabelText} from './member-label';
import type {WorkspaceAccess} from './workspace-access';
import './factory-organization.css';

const copy={
 pl:{createGroup:'Dodaj grupę',confirm:'Zarchiwizuj',metadata:'Działy i grupy porządkują listę pracowników. Nie zmieniają uprawnień do danych.',dateLimit:'Wybierz okres nie dłuższy niż 32 dni.',tooMany:'Wyświetlono pierwsze 1000 pozycji. Zawęź okres.',conflict:'Nazwa już istnieje lub wpis został zmieniony. Sprawdź aktualną listę.',noUnits:'Nie ma jeszcze żadnych grup ani działów.',workerFilter:'Szukaj pracownika',sameIdentity:'Pracownik o takim samym oznaczeniu'},
 en:{createGroup:'Add group',confirm:'Archive',metadata:'Departments and groups organize the roster. They do not change access permissions.',dateLimit:'Choose a range of no more than 32 days.',tooMany:'Showing the first 1,000 results. Narrow the date range.',conflict:'This name is in use or someone changed this item. Check the updated list.',noUnits:'There are no groups or departments yet.',workerFilter:'Find a worker',sameIdentity:'Worker with the same display label'},
 ru:{createGroup:'Добавить группу',confirm:'В архив',metadata:'Отделы и группы упорядочивают работников. Они не меняют права доступа к данным.',dateLimit:'Выберите период не больше 32 дней.',tooMany:'Показаны первые 1000 записей. Сократите период.',conflict:'Это название занято или запись уже изменили. Проверьте список.',noUnits:'Пока нет групп и отделов.',workerFilter:'Найти работника',sameIdentity:'Работник с такой же подписью'},
 uk:{createGroup:'Додати групу',confirm:'До архіву',metadata:'Відділи та групи впорядковують працівників. Вони не змінюють права доступу до даних.',dateLimit:'Виберіть період не більше 32 днів.',tooMany:'Показано перші 1000 записів. Скоротіть період.',conflict:'Ця назва зайнята або запис уже змінили. Перевірте список.',noUnits:'Груп і відділів ще немає.',workerFilter:'Знайти працівника',sameIdentity:'Працівник із таким самим підписом'},
};
const languageCopy=(l:string)=>copy[l.split('-')[0] as keyof typeof copy]??copy.pl;
const localDate=(extra=0)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()+extra*86400000);
type Editor={kind:FactoryRosterUnit['kind'];id:string|null;revision:number|null;name:string;departmentId:string|null;leaderId:string|null;workers:string[]};
const draft=(kind:Editor['kind'],unit?:FactoryRosterUnit):Editor=>unit?{kind,id:unit.id,revision:unit.revision,name:unit.name,departmentId:unit.departmentId,leaderId:unit.leaderId,workers:[...unit.workers]}:{kind,id:null,revision:null,name:'',departmentId:null,leaderId:null,workers:[]};
type Plans=ReturnType<typeof parseFactorySchedule>;
type Resource<T>={key:string;data?:T;failed?:boolean};

export function FactoryOrganizationPanel({access,screen}:{access:WorkspaceAccess;screen:'teams'|'schedule'}){
 const {t,i18n}=useTranslation(),c=factoryRoleCopy(i18n.language),x=languageCopy(i18n.language);
 const organizationId=access.organization.id,membershipId=access.membership.id,authorized=access.organization.kind==='factory'&&access.membership.role==='factory_admin';
 const [requested,setRequested]=useState(''),worksiteId=access.worksites.find(s=>s.id===requested)?.id??access.worksites[0]?.id??'';
 const [from,setFrom]=useState(()=>localDate()),[to,setTo]=useState(()=>localDate(6)),[worker,setWorker]=useState(''),[group,setGroup]=useState('');
 const [roster,setRoster]=useState<Resource<FactoryRoster>>({key:''}),[schedule,setSchedule]=useState<Resource<Plans>>({key:''}),[refresh,setRefresh]=useState(0);
 const [editor,setEditor]=useState<Editor>(),[archiving,setArchiving]=useState<FactoryRosterUnit>(),[workerFilter,setWorkerFilter]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false);
 const [error,setError]=useState(''),[saved,setSaved]=useState(false);
 const scoped=organizationId+':'+membershipId+':'+worksiteId,period=scoped+':'+from+':'+to;
 const scopedRoster=roster.key===scoped?roster.data:undefined,scopedPlans=schedule.key===period?schedule.data:undefined,periodOk=validFactoryPeriod(from,to);
 const {context:names}=useMemberNames(authorized?organizationId:undefined,refresh);
 useEffect(()=>{
  if(!authorized||!worksiteId)return;
  const abort=new AbortController();
  void factoryCall('factory-roster',{organizationId,worksiteId},abort.signal).then(raw=>parseFactoryRoster(raw,{organizationId,membershipId,worksiteId})).then(data=>{if(!abort.signal.aborted)setRoster({key:scoped,data})}).catch(()=>{if(!abort.signal.aborted)setRoster({key:scoped,failed:true})});
  return()=>abort.abort();
 },[authorized,organizationId,membershipId,scoped,worksiteId,refresh]);
 useEffect(()=>{
  if(!authorized||screen!=='schedule'||!worksiteId||!periodOk)return;
  const abort=new AbortController();
  void factoryCall('factory-schedule',{organizationId,worksiteId,dateFrom:from,dateTo:to},abort.signal).then(raw=>parseFactorySchedule(raw,{organizationId,membershipId,worksiteId},from,to)).then(data=>{if(!abort.signal.aborted)setSchedule({key:period,data})}).catch(()=>{if(!abort.signal.aborted)setSchedule({key:period,failed:true})});
  return()=>abort.abort();
 },[authorized,screen,organizationId,membershipId,period,periodOk,worksiteId,from,to,refresh]);
 const find=(id:string|null)=>scopedRoster?.units.find(u=>u.id===id);
 const indexedNames=useMemo(()=>new Map(names?.workers.map(w=>[w.membershipId,w])??[]),[names]);
 const prefLabel=(id:string)=>{const w=indexedNames.get(id);return workerLabelText(w?{...w,source:'current'}:undefined,t('memberNames.missing'),t('memberNames.reference'))};
 const options=useMemo(()=>{const out=scopedRoster?.members??[...new Set(scopedPlans?.rows.map(p=>p.membershipId)??[])];return out},[scopedRoster,scopedPlans]);
 const labels=options.map(id=>({id,name:prefLabel(id)}));
 const multiplicity=new Map<string,number>();for(const {name} of labels)multiplicity.set(name,(multiplicity.get(name)??0)+1);
 if(!authorized)return null;
 function switchSite(id:string){setRequested(id);setGroup('');setWorker('');setEditor(undefined);setArchiving(undefined);setError('');setSaved(false)}
 function edit(kind:Editor['kind'],unit?:FactoryRosterUnit){setEditor(draft(kind,unit));setError('');setSaved(false);setWorkerFilter('')}
 async function save(action:'factory-unit-save'|'factory-unit-archive'){
  if(!worksiteId||!scopedRoster||pending.current||action==='factory-unit-save'&&!editor||action==='factory-unit-archive'&&!archiving)return;
  pending.current=true;setBusy(true);setError('');setSaved(false);
  try{
   const result=await factoryCall(action,action==='factory-unit-save'?{organizationId,worksiteId,...editor,name:editor!.name.trim()}:{organizationId,worksiteId,id:archiving!.id,revision:archiving!.revision}) as {id?:string;state?:string;revision?:number};
   if(action==='factory-unit-save'&&(!result?.id||!Number.isInteger(result.revision))||action==='factory-unit-archive'&&result?.state!=='archived')throw Error('unavailable');
   setRoster({key:scoped});setRefresh(n=>n+1);setEditor(undefined);setArchiving(undefined);setSaved(true);
  }catch(e){
   const conflict=e instanceof Error&&e.message==='conflict';setError(conflict?x.conflict:c.resourceError);
   if(conflict)setRefresh(n=>n+1);
  }finally{pending.current=false;setBusy(false)}
 }
 const inputSite=<label className="field-label">{c.locations}<select value={worksiteId} onChange={e=>switchSite(e.target.value)} disabled={busy}>{access.worksites.map(site=><option value={site.id} key={site.id}>{site.name}</option>)}</select></label>;
 const status=(r:Resource<unknown>,key:string)=>r.key===key&&r.failed?<p role="alert">{c.resourceError} <button type="button" className="button button--outline" onClick={()=>{setRoster({key:scoped});setSchedule({key:period});setRefresh(n=>n+1)}}>{t('timecards.refresh')}</button></p>:<p role="status">{t('timecards.checking')}</p>;
 const showable=scopedPlans?.rows.filter(p=>(!worker||p.membershipId===worker)&&(!group||Boolean(find(group)?.workers.includes(p.membershipId))));
 const visibleDate=(value:string)=>new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value));
 if(!worksiteId)return <section className="dashboard-panel"><p>{c.noSites}</p></section>;
 if(screen==='schedule')return <section className="dashboard-panel schedule-center-panel factory-organization">
  <header className="panel-heading"><h2>{t('workflow.schedule.title')}</h2></header>
  <p className="muted-copy">{t('workflow.factory.plannedSchedulesSeparate')}</p>
  <div className="schedule-readonly-filters factory-organization__filters">
   {inputSite}
   <label className="field-label">{t('workflow.schedule.startDate')}<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label className="field-label">{t('workflow.schedule.endDate')}<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <label className="field-label">{t('workflow.schedule.worker')}<select value={worker} onChange={e=>setWorker(e.target.value)}><option value="">{t('common.all')}</option>{labels.map(({id,name},i)=><option key={id} value={id}>{name}{multiplicity.get(name)!>1?' ('+(i+1)+')':''}</option>)}</select></label>
   {scopedRoster&&!!scopedRoster.units.length&&<label className="field-label">{t('workflow.groups.title')}<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">{t('common.all')}</option>{scopedRoster.units.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select></label>}
  </div>
  {!periodOk?<p role="status">{x.dateLimit}</p>:!scopedPlans?status(schedule,period):!showable?.length?<p>{t('workflow.schedule.empty')}</p>:<div className="factory-organization__list">{showable.map(p=><article className={'schedule-card'+(p.state==='cancelled'?' is-cancelled':'')} key={p.id+':'+p.membershipId}><div className="schedule-card-head"><div><strong>{prefLabel(p.membershipId)}</strong><span>{visibleDate(p.localDate)} · {p.startTime}–{p.endTime}</span></div><span className={'status-pill status-pill--'+p.state}>{t('workflow.schedule.state.'+p.state)}</span></div></article>)}</div>}
  {scopedPlans?.overflow&&<p role="status">{x.tooMany}</p>}
 </section>;
 return <section className="dashboard-panel factory-organization">
  <header className="panel-heading"><h3>{t('workflow.factory.sharedDepartments')} / {t('workflow.groups.title')}</h3></header>
  <p className="muted-copy">{x.metadata}</p>{inputSite}
  {!scopedRoster?status(roster,scoped):<>
   <div className="form-actions"><button type="button" className="button button--outline" onClick={()=>edit('department')}>{t('workflow.factory.addDepartment')}</button><button type="button" className="button button--outline" onClick={()=>edit('group')}>{x.createGroup}</button></div>
   {!scopedRoster.units.length?<p>{x.noUnits}</p>:<div className="factory-organization__list">{scopedRoster.units.map(u=><article className="notice-box timecards-row" key={u.id}><div><strong>{u.name}</strong><p>{t(u.kind==='department'?'workflow.factory.department':'workflow.groups.title')} · {u.workers.length} {c.workers}{find(u.departmentId)&&' · '+find(u.departmentId)?.name}{u.leaderId&&' · '+prefLabel(u.leaderId)}</p></div><div className="form-actions"><button type="button" className="button button--outline" onClick={()=>edit(u.kind,u)}>{t('timecards.edit')}</button><button type="button" className="button button--outline" onClick={()=>{setArchiving(u);setError('');setSaved(false)}}>{x.confirm}</button></div></article>)}</div>}
  </>}
  {saved&&<p role="status">{c.created}</p>}
  {editor&&scopedRoster&&<AgencyBookDrawer title={editor.id?editor.name:editor.kind==='department'?t('workflow.factory.addDepartment'):x.createGroup} closeLabel={c.close} busy={busy} onClose={()=>setEditor(undefined)}>
   <form className="auth-form" onSubmit={e=>{e.preventDefault();if(editor.name.trim())void save('factory-unit-save')}}>
    <label className="field-label">{t('workflow.groups.name')}<input value={editor.name} required maxLength={80} disabled={busy} onChange={e=>{setEditor({...editor,name:e.target.value});setError('')}}/></label>
    {editor.kind==='group'&&<>
     <label className="field-label">{t('workflow.factory.department')}<select value={editor.departmentId??''} disabled={busy} onChange={e=>setEditor({...editor,departmentId:e.target.value||null})}><option value="">{t('workflow.factory.unassigned')}</option>{scopedRoster.units.filter(u=>u.kind==='department').map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
     <label className="field-label">{t('workflow.factory.leaderOptional')}<select value={editor.leaderId??''} disabled={busy} onChange={e=>setEditor({...editor,leaderId:e.target.value||null})}><option value="">{t('workflow.factory.unassigned')}</option>{scopedRoster.leaders.map((id,i)=><option value={id} key={id}>{prefLabel(id)} ({i+1})</option>)}</select></label>
    </>}
    <label className="field-label">{x.workerFilter}<input type="search" value={workerFilter} disabled={busy} onChange={e=>setWorkerFilter(e.target.value)}/></label>
    <fieldset className="permission-checks factory-organization__employees"><legend>{t('workflow.schedule.chooseWorkers')} ({editor.workers.length}/200)</legend>
     {labels.filter(({id,name})=>editor.workers.includes(id)||name.toLocaleLowerCase().includes(workerFilter.trim().toLocaleLowerCase())).slice(0,350).map(({id,name},index)=><label key={id} className="checkbox-field"><input type="checkbox" disabled={busy||editor.workers.length>=200&&!editor.workers.includes(id)} checked={editor.workers.includes(id)} onChange={e=>setEditor({...editor,workers:e.target.checked?[...editor.workers,id]:editor.workers.filter(w=>w!==id)})}/><span>{name}{multiplicity.get(name)!>1?' ('+(index+1)+')':''}</span></label>)}
     {!options.length&&<p>{c.noWorkers}</p>}
    </fieldset>
    <button className="button button--primary" disabled={busy||!editor.name.trim()}>{t('common.save')}</button>
   </form>{error&&<p role="alert">{error}</p>}
  </AgencyBookDrawer>}
  {archiving&&<AgencyBookDrawer title={archiving.name} closeLabel={c.close} busy={busy} onClose={()=>setArchiving(undefined)}><button type="button" className="button button--primary" disabled={busy||!scopedRoster} onClick={()=>void save('factory-unit-archive')}>{x.confirm}</button>{error&&<p role="alert">{error}</p>}</AgencyBookDrawer>}
 </section>;
}
