import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {FactoryTimecardsPanel} from './FactoryTimecardsPage';
import {factoryCall,parseSetupContext,type SetupContext} from './factory-enrollment';
import {independenceCall,parseIndependence,type FactoryIndependenceContext} from './factory-independence';
import {factoryHoursCall,parseFactoryHours,type FactoryHoursContext} from './factory-timecards';
import {factoryRoleCopy} from './factory-role-copy';
import {useMemberNames} from './MemberNames';
import type {WorkspaceAccess} from './workspace-access';

export type FactoryRoleSection='home'|'setup'|'workers'|'teams'|'factory-timecards'|'timesheets'|'settings';
type Action='create'|'connect'|'claim'|'leader'|'worker';
type Result<T>={value?:T;error?:boolean};
const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s);
const inviteCode=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
export function FactoryRolePanel({access,section}:{access:WorkspaceAccess;section:FactoryRoleSection}){
 const leader=access.membership.role==='team_leader';
 const admin=access.membership.role==='factory_admin';
 const {i18n}=useTranslation(),copy=factoryRoleCopy(i18n.language);
 if(access.organization.kind!=='factory'||!(leader||admin))return null;
 if(leader&&['factory-timecards','timesheets'].includes(section))return <FactoryTimecardsPanel key={access.membership.id+':'+section} organizationId={access.organization.id} leaderSection={section==='timesheets'?'timesheets':'hours'} expectedRole="team_leader" expectedMembershipId={access.membership.id}/>;
 if(leader&&['setup','settings'].includes(section)||admin&&['factory-timecards','timesheets'].includes(section))return <p role="status">{copy.closed}</p>;
 return <FactoryManagement key={access.organization.id+':'+access.membership.id+':'+section} access={access} section={section}/>;
}

function FactoryManagement({access,section}:{access:WorkspaceAccess;section:FactoryRoleSection}){
 const {t,i18n}=useTranslation(),c=factoryRoleCopy(i18n.language),f=(name:string)=>t('factoryEnrollment.'+name),ind=(name:string)=>t('factoryIndependent.'+name),h=(name:string)=>t('factoryHours.'+name);
 const org=access.organization.id,admin=access.membership.role==='factory_admin',base='/workspace/'+org;
 const [setup,setSetup]=useState<Result<SetupContext>>({}),[independent,setIndependent]=useState<Result<FactoryIndependenceContext>>({}),[hours,setHours]=useState<Result<FactoryHoursContext>>({});
 const [refresh,reload]=useState(0),[selected,setSelected]=useState(''),[modal,setModal]=useState<Action>(),[formSite,setFormSite]=useState('');
 const [value,setValue]=useState(''),[date,setDate]=useState(()=>new Date().toISOString().slice(0,10)),[notice,setNotice]=useState({text:'',error:false}),[busy,setBusy]=useState(false);
 const [initialAgencyInvite,setInitialAgencyInvite]=useState(()=>section==='setup'?new URLSearchParams(window.location.hash.slice(1)).get('agencyInvite')??'':'');
 const [invite,setInvite]=useState<{url:string;expiresAt:string}>(),[confirm,setConfirm]=useState<{label:string;run:()=>Promise<unknown>}>(),pending=useRef(false),operation=useRef(crypto.randomUUID());
 const listPeople=section==='workers'||section==='teams';
 const needSetup=admin,needHours=listPeople,needInvites=admin&&section==='workers';
 const {label}=useMemberNames(org,refresh);
 useEffect(()=>{
  const a=new AbortController();
  function load<T>(p:Promise<T>,apply:(state:Result<T>)=>void){void p.then(value=>{if(!a.signal.aborted)apply({value})}).catch(()=>{if(!a.signal.aborted)apply({error:true})})}
  if(needSetup)load(factoryCall('context',undefined,a.signal).then(parseSetupContext).then(v=>{if(!v.memberships.some(m=>m.organizationId===org&&m.id===access.membership.id&&m.kind==='factory'&&m.role==='factory_admin'))throw Error();return v}),setSetup);
  if(needHours)load(factoryHoursCall(org,'context',undefined,a.signal).then(v=>parseFactoryHours(v,org)).then(v=>{if(v.role!==access.membership.role||v.membershipId!==access.membership.id)throw Error();return v}),setHours);
  if(needInvites)load(independenceCall('context',undefined,a.signal).then(parseIndependence),setIndependent);
  return()=>a.abort();
 },[needSetup,needHours,needInvites,org,access.membership.id,access.membership.role,refresh]);
 const sites=admin&&setup.value?setup.value.worksites.filter(s=>s.ownerKind==='factory'&&s.ownerId===org&&s.organizationId===org&&s.role==='factory_admin'):access.worksites;
 const siteIds=new Set(sites.map(s=>s.id)),scoped=(site:string)=>siteIds.has(site)&&(!selected||selected===site),siteLabel=(id:string)=>sites.find(s=>s.id===id)?.name??'';
 const links=(setup.value?.connections??[]).filter(s=>s.factoryId===org&&scoped(s.worksiteId));
 const leaders=(setup.value?.assignments??[]).filter(s=>s.organizationId===org&&s.role==='team_leader'&&s.state==='active'&&scoped(s.worksiteId));
 const direct=(setup.value?.assignments??[]).filter(s=>s.organizationId===org&&s.role==='worker'&&s.state==='active'&&scoped(s.worksiteId));
 const placements=(hours.value?.placements??[]).filter(p=>uuid(p.id)&&scoped(p.worksiteId));
 const assigned=(hours.value?.assignments??[]).filter(p=>uuid(p.membershipId)&&scoped(p.worksiteId));
 const workerInvites=(independent.value?.workerInvitations??[]).filter(x=>x.factoryId===org&&scoped(x.worksiteId));
 const leaderInvites=(setup.value?.invitations??[]).filter(x=>x.factoryId===org&&x.state==='pending'&&scoped(x.worksiteId));
 const actionLabel=(a:Action)=>a==='create'?f('createSite'):a==='connect'?f('requestTitle'):a==='claim'?ind('agencyInvite'):a==='leader'?f('leaderInvite'):ind('inviteWorker');
 const issue=(message:string)=>setNotice({text:message,error:true});
 useEffect(()=>{
  if(section==='setup'&&new URLSearchParams(window.location.hash.slice(1)).has('agencyInvite'))history.replaceState(history.state,'',window.location.pathname+window.location.search);
 },[section]);
 useEffect(()=>{
  if(admin&&setup.value&&!setup.error&&sites.length&&inviteCode(initialAgencyInvite)){
   setModal('claim');setValue(initialAgencyInvite);setFormSite(sites[0].id);setInitialAgencyInvite('');
  }
 },[admin,initialAgencyInvite,setup,sites]);
 function open(a:Action){setModal(a);setValue('');setNotice({text:'',error:false});setInvite(undefined);setFormSite(selected||sites[0]?.id||'');operation.current=crypto.randomUUID()}
 async function change(run:()=>Promise<unknown>,kind?:Action){
  if(!admin||!setup.value||setup.error||pending.current)return;
  setBusy(true);pending.current=true;setNotice({text:'',error:false});
  try{
   const response=await run();
   if(kind==='worker'||kind==='leader'){
    const out=response as {code:unknown;expiresAt:string};
    if(!inviteCode(out?.code)||!Number.isFinite(Date.parse(out?.expiresAt)))throw Error('unavailable');
    setInvite({url:window.location.origin+(kind==='worker'?'/factory/team/join#factoryWorker=':'/leader/access#invite=')+out.code,expiresAt:out.expiresAt});
   }else{setModal(undefined);setConfirm(undefined)}
   setNotice({text:c.created,error:false});reload(r=>r+1);
  }catch(error){issue(error instanceof Error&&['login','denied','invalid','conflict'].includes(error.message)?t('timecards.'+error.message):c.resourceError)}
  finally{pending.current=false;setBusy(false)}
 }
 const firstDate=(d:string)=>d+'T00:00:00.000Z';
 const dateOK=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(firstDate(date)));
 const linkReady=setup.value?.connections.some(s=>s.factoryId===org&&s.worksiteId===formSite&&s.state==='active');
 const allowed=modal==='create'?Boolean(value.trim())&&value.trim().length<=120:siteIds.has(formSite)&&(modal==='connect'?/^\d{10}$/.test(value):modal==='claim'?inviteCode(value.trim()):dateOK&&(modal!=='leader'||linkReady));
 function send(){if(!allowed||invite)return;
  if(modal==='create')return change(()=>factoryCall('create-site',{organizationId:org,name:value.trim(),operationId:operation.current}),modal);
  if(modal==='connect')return change(()=>factoryCall('request-connection',{worksiteId:formSite,agencyNip:value}),modal);
  if(modal==='claim')return change(()=>independenceCall('claim-agency-invitation',{worksiteId:formSite,code:value.trim()}),modal);
  if(modal==='leader')return change(()=>factoryCall('invite-leader',{worksiteId:formSite,startsAt:firstDate(date)}),modal);
  if(modal==='worker')return change(()=>independenceCall('invite-worker',{worksiteId:formSite,startsAt:firstDate(date)}),modal);
 }
 function body<T>(result:Result<T>,render:(v:T)=>React.ReactNode){return result.error?<p role="alert">{c.resourceError}</p>:result.value?render(result.value):<p role="status">{t('timecards.checking')}</p>}
 const button=(label:string,onClick:()=>void,disabled=false)=><button type="button" className="button button--outline" onClick={onClick} disabled={busy||disabled}>{label}</button>;
 const row=(name:string,details:string,key:string,action?:React.ReactNode)=><article className="notice-box timecards-row" key={key}><div><strong>{name}</strong>{details&&<p>{details}</p>}</div>{action}</article>;
 const dateText=(d:string)=>Number.isFinite(Date.parse(d))?new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeZone:'UTC'}).format(Date.parse(d)):'';
 const revoke=(label:string,run:()=>Promise<unknown>)=>button(label,()=>{setNotice({text:'',error:false});setConfirm({label,run})});
 const sectionTitle=section==='home'?(admin?c.home:c.leader):section==='setup'?c.setup:section==='workers'?c.workers:section==='teams'?c.teams:c.settings;
 const actionReady=!!setup.value&&!setup.error;
 return <section className="timecards workflow-stack" aria-busy={busy}>
  <header><h2>{sectionTitle}</h2>{setup.value?.memberships.find(m=>m.id===access.membership.id)?.name&&<p>{setup.value.memberships.find(m=>m.id===access.membership.id)?.name}</p>}</header>
  {section!=='home'&&section!=='settings'&&!!sites.length&&<label className="field-label">{c.locations}<select value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">{c.allSites}</option>{sites.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
  {section==='home'&&<><h3>{c.locations}</h3>{sites.length?sites.map(s=>row(s.name,'',s.id)):<p>{c.noSites}</p>}<nav className="timecards-pair" aria-label={sectionTitle}><Link className="button button--outline" to={base+'/workers'}>{c.workers}</Link><Link className="button button--outline" to={base+(admin?'/setup':'/factory-timecards')}>{admin?c.setup:h('title')}</Link></nav></>}
  {section==='settings'&&<><h3>{c.locations}</h3>{body(setup,()=>sites.length?sites.map(s=>row(s.name,'',s.id)):<p>{c.noSites}</p>)}{button(actionLabel('create'),()=>open('create'),!actionReady)}</>}
  {section==='setup'&&<>{body(setup,()=>links.length?links.map(x=>row(x.agencyName,siteLabel(x.worksiteId)+' · '+f(x.state),x.id)):<p>{c.noLinks}</p>)}<div className="timecards-pair">{button(actionLabel('connect'),()=>open('connect'),!actionReady||!sites.length)}{button(actionLabel('claim'),()=>open('claim'),!actionReady||!sites.length)}</div>{!sites.length&&<Link to={base+'/settings'}>{c.goSettings}</Link>}</>}
  {listPeople&&!admin&&body(hours,()=>assigned.length?assigned.map(x=>row(label(x.membershipId),siteLabel(x.worksiteId)+' · '+x.agencyName,x.worksiteId+':'+x.membershipId)):<p>{c.noWorkers}</p>)}
  {section==='teams'&&admin&&<>
   {body(setup,()=>leaders.length?leaders.map(x=>row(label(x.membershipId),siteLabel(x.worksiteId)+' · '+dateText(x.startsAt),x.worksiteId+':'+x.membershipId,revoke(f('revokeAssignment'),()=>factoryCall('revoke-assignment',{worksiteId:x.worksiteId,membershipId:x.membershipId})))):<p>{c.noLeaders}</p>)}
   {button(actionLabel('leader'),()=>open('leader'),!actionReady||!sites.length)}
   {leaderInvites.map(x=>row(f('leaderInvite'),siteLabel(x.worksiteId)+' · '+dateText(x.expiresAt),x.id,revoke(f('revokeInvite'),()=>factoryCall('revoke-invitation',{id:x.id}))))}
  </>}
  {section==='workers'&&admin&&<>
   <h3>{c.directWorkers}</h3>{body(setup,()=>direct.length?direct.map(x=>{const claim=workerInvites.find(i=>i.membershipId===x.membershipId&&i.worksiteId===x.worksiteId&&i.state==='claimed');return row(label(x.membershipId),siteLabel(x.worksiteId)+' · '+dateText(x.startsAt),x.worksiteId+':'+x.membershipId,claim&&revoke(ind('revokeWorker'),()=>independenceCall('revoke-worker',{id:claim.id})))}):<p>{c.noWorkers}</p>)}
   {button(actionLabel('worker'),()=>open('worker'),!actionReady||!sites.length||!independent.value||independent.error)}
   {body(independent,()=>workerInvites.filter(x=>x.state==='pending').map(x=>row(ind('invitationPending'),siteLabel(x.worksiteId)+' · '+dateText(x.startsAt),x.id,revoke(ind('revokeWorker'),()=>independenceCall('revoke-worker',{id:x.id})))))}
   <h3>{c.newRequests}</h3>{body(hours,()=>placements.some(p=>p.state==='pending')?placements.filter(p=>p.state==='pending').map(p=>row(label(p.membershipId),siteLabel(p.worksiteId)+' · '+dateText(p.startsAt),p.id,button(h('approvePlacement'),()=>void change(()=>factoryHoursCall(org,'approve-placement',{worksiteId:p.worksiteId,id:p.id,operationId:crypto.randomUUID(),confirmed:true})),!actionReady))):<p>{c.emptyRequests}</p>)}
   <h3>{c.agencyWorkers}</h3>{body(hours,()=>assigned.length?assigned.map(x=>{const placement=placements.find(p=>p.membershipId===x.membershipId&&p.agencyId===x.agencyId&&p.worksiteId===x.worksiteId&&p.state==='approved');return row(label(x.membershipId),siteLabel(x.worksiteId)+' · '+x.agencyName,x.worksiteId+':'+x.membershipId,placement&&revoke(h('revoke'),()=>factoryHoursCall(org,'revoke-placement',{worksiteId:x.worksiteId,id:placement.id,operationId:crypto.randomUUID()})))}):<p>{c.noWorkers}</p>)}
  </>}
  {!modal&&!confirm&&notice.text&&<p role={notice.error?'alert':'status'}>{notice.text}</p>}
  {confirm&&<AgencyBookDrawer title={confirm.label} closeLabel={c.close} busy={busy} onClose={()=>setConfirm(undefined)}>
   <button type="button" className="button button--primary" disabled={busy||!actionReady} onClick={()=>void change(confirm.run)}>{confirm.label}</button>
   {notice.text&&<p role={notice.error?'alert':'status'}>{notice.text}</p>}
  </AgencyBookDrawer>}
  {modal&&<AgencyBookDrawer title={actionLabel(modal)} closeLabel={c.close} busy={busy} onClose={()=>{setModal(undefined);setInvite(undefined)}}>
   {invite?<div className="auth-form"><p>{ind('expires')}: {new Intl.DateTimeFormat(i18n.language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(invite.expiresAt))}</p><label className="field-label">{ind('link')}<textarea readOnly rows={3} value={invite.url} onFocus={e=>e.target.select()}/></label>{button(c.copy,()=>void navigator.clipboard?.writeText(invite.url).then(()=>setNotice({text:c.copied,error:false})).catch(()=>issue(c.copyFailed)),!navigator.clipboard)}</div>:
   <form className="auth-form" onSubmit={e=>{e.preventDefault();void send()}}>
    {modal!=='create'&&<label className="field-label">{c.locations}<select required disabled={busy} value={formSite} onChange={e=>setFormSite(e.target.value)}>{sites.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
    {modal==='leader'&&!linkReady&&<p>{c.inviteFirst}</p>}
    {modal==='leader'||modal==='worker'?<label className="field-label">{f('starts')}<input type="date" required disabled={busy} value={date} onChange={e=>setDate(e.target.value)}/></label>:
     <label className="field-label">{modal==='create'?f('siteName'):modal==='connect'?f('agencyNip'):ind('agencyCode')}<input required disabled={busy} inputMode={modal==='connect'?'numeric':'text'} autoComplete="off" maxLength={modal==='create'?120:modal==='connect'?10:64} value={value} onChange={e=>{setValue(e.target.value);operation.current=crypto.randomUUID()}}/></label>}
    <button className="button button--primary" disabled={busy||!allowed}>{actionLabel(modal)}</button>
   </form>}
   {notice.text&&<p role={notice.error?'alert':'status'}>{notice.text}</p>}
  </AgencyBookDrawer>}
 </section>;
}
