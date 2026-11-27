import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {agencyWorkerCopy} from './agency-workers-copy';
import {factoryCall,parseSetupContext,type SetupContext} from './factory-enrollment';
import {factoryHoursCall,parseFactoryHours,type FactoryHoursContext} from './factory-timecards';
import {memberNamesCall,useMemberNames} from './MemberNames';
import {accountCall} from './worker-account';
import {workerCall} from './worker-enrollment';

type Props={organizationId:string;enrollmentEnabled:boolean;productionsEnabled:boolean;lifecycleEnabled:boolean;namesEnabled:boolean;factoryHoursEnabled?:boolean;siteId?:string;initialSection?:'roster'|'applications'};
type Application={application_id:string;claimed_at:string};
type Member={membershipId:string;state:string;endedAt:string|null};
type WorkersResponse={organizationId:string;workers:Member[]};
type UiDrawer={type:'invite'}|{type:'worker';id:string};
type CopyKey=keyof typeof agencyWorkerCopy.en;
type WorkAssignment={worksiteId:string;startsAt:string;endsAt?:string|null};
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'));

export function AgencyWorkersPanel({organizationId,enrollmentEnabled,productionsEnabled,lifecycleEnabled,namesEnabled,factoryHoursEnabled=false,siteId,initialSection='roster'}:Props){
 const {t,i18n}=useTranslation();
 const lang=(i18n.resolvedLanguage??'en').toLowerCase().split('-')[0];
 const strings=agencyWorkerCopy[lang as keyof typeof agencyWorkerCopy]??agencyWorkerCopy.en;
 const copy=(key:CopyKey)=>strings[key];
 const dates=new Intl.DateTimeFormat(lang,{dateStyle:'medium',timeZone:'Europe/Warsaw'});
 const queuePath='agency/'+organizationId;
 const [section,setSection]=useState(initialSection),[revision,R]=useState(0),[queueRevision,Q]=useState(0);
 const [setup,S]=useState<SetupContext>(),[factory,F]=useState<FactoryHoursContext>();
 const [members,M]=useState<WorkersResponse>(),[applications,A]=useState<Application[]>();
 const [failed,RF]=useState(false),[queueFailed,QF]=useState(false);
 const [filter,G]=useState(siteId??''),[query,Search]=useState('');
 const [drawer,open]=useState<UiDrawer>(),[invite,I]=useState<{code:string;link:string}>();
 const [target,T]=useState(''),[source,From]=useState(''),[day,D]=useState(localDay);
 const [name,N]=useState(''),[confirmedName,CN]=useState(false),[confirmedEnd,CE]=useState(false);
 const [busy,B]=useState(false),[notice,U]=useState<CopyKey|'nameSaved'|'approved'>(),[error,E]=useState(false);
 const pending=useRef(false),panel=useRef<HTMLElement>(null);
 const {context:names,state:nameState,label}=useMemberNames(namesEnabled?organizationId:undefined,revision);
 const scopedNames=names?.organizationId===organizationId?names:undefined;
 const scopedSetup=setup?.memberships.some(row=>row.organizationId===organizationId&&row.role==='agency_admin')?setup:undefined;
 const scopedFactory=factory?.organizationId===organizationId&&factory.role==='agency_admin'?factory:undefined;
 const scopedMembers=members?.organizationId===organizationId?members:undefined;

 useEffect(()=>{
  const c=new AbortController();RF(false);
  if(productionsEnabled)void factoryCall('context',undefined,c.signal).then(parseSetupContext).then(v=>{
   if(!v.memberships.some(m=>m.organizationId===organizationId&&m.role==='agency_admin'))throw Error('denied');
   if(!c.signal.aborted)S(v);
  }).catch(()=>{if(!c.signal.aborted)RF(true)});
  if(lifecycleEnabled)void accountCall('agency-context',{organizationId},c.signal).then(result=>{
   const v=result as WorkersResponse;
   if(v?.organizationId!==organizationId||!Array.isArray(v.workers)||v.workers.some(w=>!uuid(w.membershipId)||typeof w.state!=='string'))throw Error('unavailable');
   if(!c.signal.aborted)M(v);
  }).catch(()=>{if(!c.signal.aborted)RF(true)});
  if(factoryHoursEnabled)void factoryHoursCall(organizationId,'context',undefined,c.signal).then(result=>parseFactoryHours(result,organizationId)).then(v=>{
   if(v.role!=='agency_admin')throw Error('denied');
   if(!c.signal.aborted)F(v);
  }).catch(()=>{if(!c.signal.aborted)RF(true)});
  return()=>c.abort();
 },[organizationId,productionsEnabled,lifecycleEnabled,factoryHoursEnabled,revision]);
 useEffect(()=>{
  A(undefined);QF(false);
  if(section!=='applications'||!enrollmentEnabled)return;
  const c=new AbortController();
  void workerCall(queuePath,undefined,c.signal).then(result=>{
   const rows=(result as {applications?:Application[]})?.applications;
   if(!Array.isArray(rows)||rows.some(r=>!uuid(r.application_id)||!Number.isFinite(Date.parse(r.claimed_at))))throw Error('unavailable');
   if(!c.signal.aborted)A(rows);
  }).catch(()=>{if(!c.signal.aborted)QF(true)});
  return()=>c.abort();
 },[queuePath,section,enrollmentEnabled,queueRevision]);
 useEffect(()=>{
  setSection(initialSection);G(siteId??'');Search('');open(undefined);U(undefined);E(false);
 },[organizationId,siteId,initialSection]);

 const internalSites=scopedSetup?.worksites.filter(w=>w.ownerId===organizationId&&w.organizationId===organizationId&&w.ownerKind==='agency')??[];
 const connectedSites=scopedFactory?.sites.filter(site=>scopedSetup?.connections.some(c=>c.agencyId===organizationId&&c.worksiteId===site.id&&c.state==='active'))??[];
 const sites=[...internalSites.map(s=>({...s,kind:'internal' as const})),...connectedSites.map(s=>({...s,kind:'factory' as const}))]
  .sort((a,b)=>a.name.localeCompare(b.name,lang));
 const dateNow=Date.now();
 const currentAt=(a:WorkAssignment,at:number)=>Date.parse(a.startsAt)<=at&&(!a.endsAt||Date.parse(a.endsAt)>at);
 const startInstant=day===localDay()?dateNow:Date.parse(day+'T00:00:00Z');
 function workAssignments(id:string):WorkAssignment[]{
  const own=scopedSetup?.assignments.filter(a=>a.organizationId===organizationId&&a.membershipId===id&&a.state==='active'&&internalSites.some(s=>s.id===a.worksiteId))??[];
  const external=scopedFactory?.placements.filter(a=>a.agencyId===organizationId&&a.membershipId===id&&a.state==='approved'&&connectedSites.some(s=>s.id===a.worksiteId))??[];
  return [...own,...external];
 }
 const active=new Set(scopedMembers?.workers.filter(w=>w.state==='active'&&!w.endedAt).map(w=>w.membershipId)
  ??scopedSetup?.workers.filter(w=>w.organizationId===organizationId).map(w=>w.id)
  ??scopedNames?.workers.filter(w=>w.organizationId===organizationId&&w.state==='active').map(w=>w.membershipId)??[]);
 const effectiveFilter=siteId??filter;
 const roster=[...active].map(id=>{
  const assignments=workAssignments(id).filter(a=>currentAt(a,dateNow));
  const entry=scopedNames?.workers.find(w=>w.membershipId===id&&w.organizationId===organizationId);
  return {id,display:entry?label(id):id.slice(0,8),assignments,group:(effectiveFilter&&effectiveFilter!=='none'&&assignments.some(a=>a.worksiteId===effectiveFilter)?sites.find(s=>s.id===effectiveFilter):sites.find(s=>assignments.some(a=>a.worksiteId===s.id)))?.name??''};
 }).filter(w=>{
  const q=query.trim().toLocaleLowerCase(lang);
  return (!q||w.display.toLocaleLowerCase(lang).includes(q))&&(!effectiveFilter||(effectiveFilter==='none'?!w.assignments.length:w.assignments.some(a=>a.worksiteId===effectiveFilter)));
 }).sort((a,b)=>a.group.localeCompare(b.group,lang)||a.display.localeCompare(b.display,lang,{numeric:true}));
 const groups=[...new Set(roster.map(w=>w.group))];
 const id=drawer?.type==='worker'?drawer.id:undefined;
 const current=id?scopedNames?.workers.find(w=>w.membershipId===id&&w.organizationId===organizationId&&w.state==='active'):undefined;
 const moves= id?workAssignments(id).filter(a=>internalSites.some(s=>s.id===a.worksiteId)&&currentAt(a,startInstant)):[];
 const originAssignment=moves.find(a=>a.worksiteId===source)??(moves.length===1?moves[0]:undefined);
 const targetSite=sites.find(s=>s.id===target);
 const duplicate=id&&workAssignments(id).some(a=>a.worksiteId===target&&(!a.endsAt||Date.parse(a.endsAt)>startInstant));
 const rosterReady=Boolean(scopedMembers||scopedSetup||scopedNames);
 const rosterEnabled=productionsEnabled||lifecycleEnabled||namesEnabled;
 const loadFailed=failed||namesEnabled&&nameState==='unavailable';
 const reset=()=>{I(undefined);T(siteId??'');From('');D(localDay());N('');CN(false);CE(false);U(undefined);E(false)};
 const dismiss=()=>{const id=drawer?.type==='worker'?drawer.id:'';open(undefined);reset();if(id)requestAnimationFrame(()=>{(panel.current?.querySelector<HTMLElement>('[data-worker-settings='+CSS.escape(id)+']')??panel.current?.querySelector<HTMLElement>('.agency-worker-tabs button'))?.focus()})};
 function selectWorker(id:string){
  if(busy)return;reset();N(scopedNames?.workers.find(w=>w.membershipId===id)?.name??'');open({type:'worker',id});
 }
 async function run(task:()=>Promise<void>,done?:CopyKey|'nameSaved'|'approved'){
  if(pending.current)return;
  pending.current=true;B(true);U(undefined);E(false);
  try{await task();U(done)}catch{E(true)}finally{pending.current=false;B(false)}
 }
 function saveOptions(){
  if(!id||!targetSite||!validDay(day)||duplicate||!active.has(id))return;
  const payload={worksiteId:targetSite.id,membershipId:id,startsAt:new Date(day===localDay()?Date.now():startInstant).toISOString()};
  if(targetSite.kind==='factory'){
   void run(async()=>{
    await factoryHoursCall(organizationId,'propose-placement',{...payload,operationId:crypto.randomUUID()});R(x=>x+1);T('');
   },'requested');return;
  }
  if(moves.length&&!originAssignment)return;
  void run(async()=>{
   if(originAssignment)await factoryCall('transfer-internal',{...payload,fromWorksiteId:originAssignment.worksiteId});
   else await factoryCall('assign-internal',payload);
   R(x=>x+1);T('');From('');
  },originAssignment?'moved':'assigned');
 }
 function createInvite(){
  void run(async()=>{
   const result=await workerCall(queuePath+'/invite',{minutes:60}) as {invitation?:{invite_code?:string}};
   const code=result?.invitation?.invite_code;
   if(typeof code!=='string'||!/^([0-9a-f]{64})$/.test(code))throw Error('invalid invite');
   I({code,link:location.origin+'/register/worker#invite='+code});
  });
 }
 const status=error?<p className="registration-error" role="alert">{copy('rejected')}</p>:notice?<p role="status">{notice==='approved'?t('workerEnrollment.approved'):notice==='nameSaved'?t('memberNames.saved'):copy(notice)}</p>:null;
 return <section ref={panel} className="agency-worker-panel" aria-label={copy('roster')}>
  <nav className="agency-worker-tabs" aria-label={copy('roster')}>
   <button type="button" className={'button '+(section==='roster'?'button--primary':'button--outline')} aria-pressed={section==='roster'} disabled={busy} onClick={()=>{setSection('roster');U(undefined);E(false)}}>{copy('roster')}</button>
   {!siteId&&<button type="button" className={'button '+(section==='applications'?'button--primary':'button--outline')} aria-pressed={section==='applications'} disabled={busy} onClick={()=>{setSection('applications');U(undefined);E(false)}}>{copy('applications')}</button>}
   {enrollmentEnabled&&<button type="button" className="button button--outline agency-worker-add" disabled={busy} onClick={()=>{reset();open({type:'invite'})}}>{copy('add')}</button>}
  </nav>
  <div key={section} className="agency-production-leaf">
  {section==='roster'?<section className="dashboard-panel" aria-busy={rosterEnabled&&!rosterReady&&!loadFailed}>
   <div className="agency-worker-filter">
    {!siteId&&<label className="field-label">{copy('production')}<select value={filter} onChange={e=>G(e.target.value)}>
     <option value="">{copy('allProductions')}</option><option value="none">{copy('unassigned')}</option>
     {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    <label className="field-label">{copy('search')}<input type="search" maxLength={120} value={query} onChange={e=>Search(e.target.value)}/></label>
   </div>
   {loadFailed&&<div className="agency-worker-status" role="alert"><p>{copy('rosterUnavailable')}</p><button type="button" className="button button--outline button--small" onClick={()=>R(n=>n+1)}>{copy('retry')}</button></div>}
   {!rosterEnabled&&<p>{copy('noPermission')}</p>}
   {rosterEnabled&&!rosterReady&&!loadFailed&&<p role="status">{copy('load')}</p>}
   {rosterReady&&!loadFailed&&!roster.length&&<p>{copy(active.size?'noMatches':'emptyRoster')}</p>}
   {groups.map(group=><section className="agency-worker-group" key={group||'unassigned'}>
    <h3>{group||copy('unassigned')}</h3><ul>{roster.filter(w=>w.group===group).map(w=><li key={w.id}>
     <div><strong>{w.display}</strong><p className="muted-copy">{sites.filter(s=>w.assignments.some(a=>a.worksiteId===s.id)).map(s=>s.name).join(' · ')||copy('unassigned')}</p></div>
     <button type="button" className="button button--outline button--small" data-worker-settings={w.id} onClick={()=>selectWorker(w.id)}>{copy('options')}</button>
    </li>)}</ul></section>)}
  </section>:<section className="dashboard-panel" aria-busy={enrollmentEnabled&&!applications&&!queueFailed}>
   <h2>{copy('applications')}</h2>
   {!enrollmentEnabled?<p>{copy('noPermission')}</p>:<>
   <p>{t('workerEnrollment.reviewHint')}</p>
   {queueFailed?<div className="agency-worker-status" role="alert"><p>{copy('applicationsUnavailable')}</p><button type="button" className="button button--outline button--small" onClick={()=>Q(n=>n+1)}>{copy('retry')}</button></div>
   :!applications?<p role="status">{copy('load')}</p>:!applications.length?<p>{t('workerEnrollment.emptyQueue')}</p>:
   <ul className="agency-worker-applications">{applications.map(a=><li key={a.application_id}><div><strong>{t('workerEnrollment.reference')}</strong><br/><code>{a.application_id}</code><p>{dates.format(new Date(a.claimed_at))}</p></div>
    <button type="button" className="button button--primary button--small" disabled={busy} onClick={()=>void run(async()=>{
     await workerCall(queuePath+'/approve',{applicationId:a.application_id});Q(n=>n+1);R(n=>n+1);
    },'approved')}>{t('workerEnrollment.approve')}</button></li>)}</ul>}
   </>}
  </section>}
  </div>
  {!drawer&&status}
  {drawer&&<AgencyBookDrawer title={drawer.type==='invite'?copy('add'):copy('settings')} closeLabel={copy('close')} busy={busy} onClose={dismiss}>
   {drawer.type==='invite'?<>
    <p>{copy('inviteInfo')}</p>
    {!invite?<button type="button" className="button button--primary" disabled={busy} onClick={createInvite}>{t('workerEnrollment.createInvite')}</button>:
    <div className="notice-box"><p>{t('workerEnrollment.inviteCreated')}</p><label className="field-label">{t('workerEnrollment.inviteLink')}<textarea rows={2} readOnly value={invite.link}/></label>
     <label className="field-label">{t('workerEnrollment.inviteCode')}<textarea rows={2} readOnly value={invite.code}/></label>
     <div className="form-actions">
      <a className="button button--primary" href={'mailto:?subject='+encodeURIComponent(copy('emailSubject'))+'&body='+encodeURIComponent(copy('emailBody')+'\n\n'+invite.link+'\n\n'+t('workerEnrollment.inviteCode')+': '+invite.code)}>{copy('emailInvite')}</a>
     {navigator.clipboard&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>void run(()=>navigator.clipboard.writeText(invite.link),'copied')}>{copy('copy')}</button>}</div><p className="muted-copy">{copy('emailDraft')}</p></div>}
   </>:id&&<>
    <p className="agency-worker-person">{current?label(id):id.slice(0,8)}</p>
    {id&&workAssignments(id).length>0&&<ul className="agency-worker-placement-list">{workAssignments(id).map(a=>{
     const site=sites.find(s=>s.id===a.worksiteId);return site?<li key={a.worksiteId}>{site.name}{Date.parse(a.startsAt)>dateNow?' · '+copy('planned').replace('{{date}}',dates.format(new Date(a.startsAt))):''}</li>:null;
    })}</ul>}
    {scopedFactory?.placements.filter(a=>a.agencyId===organizationId&&a.membershipId===id&&a.state==='pending').map(a=><p key={a.id} className="muted-copy">{sites.find(s=>s.id===a.worksiteId)?.name} · {copy('pending')}</p>)}
    {active.has(id)&&<>
     {productionsEnabled&&scopedSetup&&<section className="agency-book-section">
      <h3>{moves.length?copy('move'):copy('assign')}</h3>
      {!sites.length?<p>{copy('emptySites')}</p>:<form className="auth-form" onSubmit={e=>{e.preventDefault();saveOptions()}}>
       <label className="field-label">{copy('toProduction')}<select value={target} disabled={busy} required onChange={e=>T(e.target.value)}><option value="">{t('factoryEnrollment.select')}</option>
        {sites.map(s=><option key={s.id} value={s.id} disabled={workAssignments(id).some(a=>a.worksiteId===s.id&&(!a.endsAt||Date.parse(a.endsAt)>startInstant))}>{s.name}</option>)}</select></label>
       {targetSite?.kind!=='factory'&&moves.length>1&&<label className="field-label">{copy('fromProduction')}<select value={source} disabled={busy} required onChange={e=>From(e.target.value)}><option value="">{t('factoryEnrollment.select')}</option>{moves.map(a=><option key={a.worksiteId} value={a.worksiteId}>{sites.find(s=>s.id===a.worksiteId)?.name}</option>)}</select></label>}
       <label className="field-label">{copy('starts')}<input type="date" value={day} min={localDay()} required disabled={busy} onChange={e=>D(e.target.value)}/></label>
       <button className="button button--primary" disabled={busy||!targetSite||!validDay(day)||Boolean(duplicate)||targetSite.kind!=='factory'&&moves.length>1&&!originAssignment}>{targetSite?.kind==='factory'?copy('sendFactory'):originAssignment?copy('move'):copy('assign')}</button>
      </form>}
     </section>}
     {namesEnabled&&current&&scopedNames?.canEdit&&<section className="agency-book-section"><h3>{copy('name')}</h3><form className="auth-form" onSubmit={e=>{
      e.preventDefault();if(!confirmedName||name.trim().length<2)return;
      void run(async()=>{await memberNamesCall(organizationId,{membershipId:id,name:name.trim(),revision:current.revision,confirmed:true,operationId:crypto.randomUUID()});CN(false);R(n=>n+1)},'nameSaved');
     }}>
      <label className="field-label">{t('memberNames.name')}<input autoComplete="off" value={name} required minLength={2} maxLength={120} disabled={busy} onChange={e=>{N(e.target.value);CN(false)}}/></label>
      <label className="timecards-check"><input type="checkbox" checked={confirmedName} disabled={busy} onChange={e=>CN(e.target.checked)}/>{t('memberNames.confirm')}</label>
      <button className="button button--outline" disabled={busy||!confirmedName||name.trim().length<2||name.trim()===current.name}>{t('memberNames.save')}</button>
     </form></section>}
     {lifecycleEnabled&&scopedMembers?.workers.some(w=>w.membershipId===id&&w.state==='active'&&!w.endedAt)&&<section className="agency-book-section"><h3>{copy('danger')}</h3>
      <p>{t('workerAccount.endLead')}</p>
      <label className="personal-confirm"><input type="checkbox" disabled={busy} checked={confirmedEnd} onChange={e=>CE(e.target.checked)}/>{t('workerAccount.confirmEnd')}</label>
      <button type="button" className="button button--outline" disabled={busy||!confirmedEnd} onClick={()=>void run(async()=>{
       const result=await accountCall('end-membership',{organizationId,membershipId:id,operationId:crypto.randomUUID(),confirmed:true}) as {state?:string};
       if(result?.state!=='ended')throw Error('unavailable');dismiss();R(n=>n+1);
      },'removed')}>{copy('danger')}</button>
     </section>}
    </>}
   </>}
   {status}
  </AgencyBookDrawer>}
 </section>;
}

