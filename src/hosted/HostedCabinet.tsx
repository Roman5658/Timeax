import {WorkerTermsGate} from './WorkerTermsGate';
import {WorkerPasswordPanel} from './WorkerPasswordPanel';
import {AgencyProfile} from './AgencyProfile';
import {AgencyNipVisibility} from './AgencyWorkerCards';
import {AgencyJoinNotifications,useAgencyJoinNotifications} from './AgencyJoinNotifications';
import {WorkerCalendar} from './WorkerCalendar';
import {FactoryRolePanel,type FactoryRoleSection} from './FactoryRolePanel';
import {AgencyWorkersPanel} from './AgencyWorkersPanel';
import {AgencyTimecardsPanel} from './AgencyTimecardsPanel';
import {AgencyProductions} from './AgencyProductions';
import {TeamBell,TeamPanel,type TeamSection} from './TeamWorkflow';

import { Building2, CalendarDays, ClipboardList, LayoutDashboard, Menu, MessageCircle, Settings2, UsersRound, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '../components/BrandMark';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ThemeToggle } from '../components/ThemeToggle';
import { createWorkingRegistrationClient } from '../modules/auth/registration/contract/registration-client';
import { useMemberNames } from './MemberNames';
import { PageHeading } from '../components/PageHeading';
import { AgencyWorkerPanel } from './WorkerEnrollmentPage';
import { TimecardsPanel } from './TimecardsPage';
import { FactoryTimecardsPanel } from './FactoryTimecardsPage';
import { FactorySetupPanel } from './FactoryEnrollmentPage';
import { PayslipsPanel } from './PayslipsPage';
import { loadWorkspaceAccess, type WorkspaceAccess, type WorkspaceResult } from './workspace-access';
import '../styles/hosted-cabinet.css';

const sectionLane:Record<string,string>={settings:'profile',workers:'worker',timecards:'timecards','factory-timecards':'factoryTimecards',payslips:'payroll',messages:'team',schedule:'team',accountants:'team'};
type Section = TeamSection | FactoryRoleSection | 'timecards' | 'payslips';
type Item = {section: Section; label: string; group: 'workspace'|'people'|'operations'|'reports'|'account'; Icon: typeof LayoutDashboard};
const item = (section: Section, label: string, group: Item['group'], Icon: Item['Icon']): Item => ({section, label, group, Icon});
const agencyMenu = [
 item('home','nav.agencyHome','workspace',LayoutDashboard),
 item('setup','nav.productions','people',Building2),
 item('workers','nav.workers','people',UsersRound),
 item('timecards','nav.timekeeping','operations',CalendarDays),
 item('schedule','team.schedule','operations',CalendarDays),
 item('messages','team.messages','operations',MessageCircle),
 item('factory-timecards','factoryHours.title','reports',ClipboardList),
 item('payslips','canonicalPayslips.title','reports',ClipboardList),
 item('accountants','team.accountants','account',UsersRound),
 item('settings','agencySettings.title','account',Settings2),
];
const workerMenu = [
 item('home','nav.workerHome','workspace',LayoutDashboard),
 item('timecards','nav.shifts','operations',CalendarDays),
 item('factory-timecards','factoryHours.title','operations',Building2),
 item('schedule','team.schedule','operations',CalendarDays),
 item('messages','team.messages','operations',MessageCircle),
 item('payslips','canonicalPayslips.title','reports',ClipboardList),
];
const factoryMenu=[item('home','nav.factoryHome','workspace',LayoutDashboard),item('setup','workflow.factory.sections.agencies','people',Building2),
 item('workers','nav.workers','people',UsersRound),item('teams','workflow.factory.sections.teams','people',UsersRound),item('settings','workflow.factory.sections.settings','account',Settings2)];
const leaderMenu=[item('home','nav.leaderHome','workspace',LayoutDashboard),item('workers','nav.teams','people',UsersRound),
 item('factory-timecards','nav.reviews','operations',ClipboardList),item('schedule','nav.schedule','operations',CalendarDays),
 item('messages','nav.messages','operations',MessageCircle),item('timesheets','nav.monthlyTimesheets','reports',ClipboardList)];
const hasProductionRole=(access:WorkspaceAccess)=>access.organization.kind==='factory'&&['factory_admin','team_leader'].includes(access.membership.role);
export function HostedCabinetRoute({organizationId, section, fallback}:{organizationId:string; section:Section; fallback:ReactNode}){
 const {t}=useTranslation(),navigate=useNavigate();
 const [status,setStatus]=useState<WorkspaceResult>();
 useEffect(()=>{
  const controller=new AbortController();
  void loadWorkspaceAccess(organizationId,location.origin,window.fetch.bind(window),controller.signal).then(result=>{
   if(!controller.signal.aborted)setStatus(result);
  });
  return()=>controller.abort();
 },[organizationId]);
 if(!status)return <main className="portal-content"><p role="status">{t('workspaceRead.checking')}</p></main>;
 if(status.state!=='ready')return fallback;
 const value=status.value,role=value.membership.role;
 if(!hasProductionRole(value)&&!(value.organization.kind==='agency'&&['agency_admin','worker'].includes(role)))return fallback;
 const menu=role==='agency_admin'?agencyMenu:role==='factory_admin'?factoryMenu:role==='team_leader'?leaderMenu:workerMenu;
 if(!menu.some(entry=>entry.section===section)&&!(role==='worker'&&['templates','absence'].includes(section)))return fallback;
 const cabinet=<HostedCabinet access={status.value} section={section} menu={menu}/>;
 return status.value.membership.role==='worker'&&/^https:\/\/(?:www\.)?timeax\.pl$/.test(location.origin)
  ?<WorkerTermsGate onSessionExpired={()=>navigate('/login',{replace:true})}>{cabinet}</WorkerTermsGate>:cabinet;
}

function HostedCabinet({access,section,menu}:{access:WorkspaceAccess; section:Section; menu:Item[]}){
 const {t}=useTranslation();
 const where=useLocation(),navigate=useNavigate();
 const [menuOpen,setMenuOpen]=useState(false);
 const agency=access.membership.role==='agency_admin';
 const production=hasProductionRole(access),worker=!agency&&!production;
 const [agencyProfile,setAgencyProfile]=useState<{public:boolean;productions:boolean;ops:string[]}>();
 useEffect(()=>{
  if(!agency)return;
  const c=new AbortController();
  void fetch('/v1/session/timeax-email',{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(async r=>r.ok?await r.json():null).then(v=>{
   if(!c.signal.aborted)setAgencyProfile({public:v?.selfService===true,productions:v?.agencyProductions===true,ops:Array.isArray(v?.agencyOperations)?v.agencyOperations:[]});
  }).catch(()=>{if(!c.signal.aborted)setAgencyProfile({public:true,productions:false,ops:[]})});
  return()=>c.abort();
 },[agency,access.organization.id]);
 const [agencyName,setAgencyName]=useState('');
 const publicAgency=agency&&agencyProfile?.public===true;
 const loadModules=!agency||agencyProfile?.public===false;
 const uses=(lane:string)=>loadModules||agencyProfile?.ops.includes(lane)===true;
 const sectionReady=uses(sectionLane[section]);
 const root='/workspace/'+access.organization.id;
 const route=(id:Section)=>root+(id==='home'?'':'/'+id);
 const home=t(menu[0].label);
 const heading=menu.find(entry=>entry.section===section)?.label??(section==='templates'?'team.templates':section==='absence'?'team.absence':menu[0].label);
 const org=access.organization.id;
 const joins=useAgencyJoinNotifications(publicAgency&&uses('workerProvisioning')?org:undefined);
 const [agencySearch]=useSearchParams();
 const unifiedHours=publicAgency&&(section==='timecards'||section==='factory-timecards');
 const directory=publicAgency&&section==='workers';
 const visibleMenu=menu.filter(entry=>(entry.section!=='settings'||publicAgency||production)&&(!publicAgency||entry.section!=='factory-timecards'));
 const {label,organizationLabel}=useMemberNames(worker?org:undefined);
 useEffect(()=>{
  if(!menuOpen)return;
  const dismiss=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenuOpen(false)};
  window.addEventListener('keydown',dismiss);
  return()=>window.removeEventListener('keydown',dismiss);
 },[menuOpen]);
 return <div className={'portal-layout hosted-cabinet portal-layout--'+(agency?'agency':production?(access.membership.role==='factory_admin'?'factory':'leader'):'worker')}>
  {menuOpen&&<button className="portal-sidebar-backdrop" type="button" aria-label={t('common.closeMenu')} onClick={()=>setMenuOpen(false)}/>}
  <aside id="hosted-cabinet-menu" className={'portal-sidebar'+(menuOpen?' is-open':'')}>
   <BrandMark/>
   <button className="portal-mobile-close" type="button" aria-label={t('common.closeMenu')} onClick={()=>setMenuOpen(false)}><X size={18}/></button>
   <div className="sidebar-divider"/>
   <nav className="portal-nav" aria-label={home}>
    {visibleMenu.map(({section:id,label,group,Icon},index)=><Fragment key={id}>
     {group!==visibleMenu[index-1]?.group&&<div className="portal-nav-group-label">{t('nav.groups.'+group)}</div>}
     <Link className={'portal-nav-link'+(id===section||unifiedHours&&id==='timecards'?' is-active':'')} aria-current={id===section||unifiedHours&&id==='timecards'?'page':undefined} to={route(id)} onClick={()=>setMenuOpen(false)}><Icon size={17} aria-hidden="true"/><span>{t(label)}</span></Link>
    </Fragment>)}
    {worker&&<><div className="portal-nav-group-label">{t('nav.groups.account')}</div><Link className="portal-nav-link" to="/account"><Settings2 size={17} aria-hidden="true"/><span>{t('nav.profile')}</span></Link><Link className="portal-nav-link" to="/register/worker"><Building2 size={17} aria-hidden="true"/><span>{t('workerEnrollment.join')}</span></Link></>}
   </nav>
   <div className="sidebar-spacer"/>
   <div className="hosted-cabinet-sign-out"><CabinetSignOut/></div>
   <div className="sidebar-user"><span className="sidebar-avatar"><UsersRound size={16} aria-hidden="true"/></span><span><strong>{t('workspaceRead.'+access.membership.role)}</strong>{worker&&<small>{label(access.membership.id)}</small>}</span></div>
  </aside>
  <div className="portal-main-column">
   <header className="portal-topline">
    <div className="portal-topline-left">
     <button className="portal-mobile-menu" type="button" aria-controls="hosted-cabinet-menu" aria-label={t('common.openMenu')} aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}><Menu size={19}/></button>
     <div className="portal-breadcrumb"><span className="breadcrumb-dot"/>{agencyName||home}</div>
    </div>
    <div className="portal-top-actions">{uses('team')&&access.membership.role!=='factory_admin'&&<TeamBell organizationId={org} additionalUnread={joins.value?.unread}/>}
    <LanguageSwitcher compact/><ThemeToggle/></div>
   </header>
   <main className="portal-content">
    <PageHeading eyebrow={worker?organizationLabel(access.membership.id):undefined} title={t(unifiedHours?'nav.timekeeping':heading)} />
    {production&&section!=='messages'&&section!=='schedule'&&<FactoryRolePanel key={org+section} access={access} section={section as FactoryRoleSection}/>}
    {publicAgency&&section!=='home'&&section!=='setup'&&!directory&&!unifiedHours&&!sectionReady&&<p className="notice-box" role="status">{t('agencyProductions.moduleNotEnabled')}</p>}
    {publicAgency&&section==='messages'&&<AgencyJoinNotifications value={joins.value} mark={joins.mark}/>}
    {uses('team')&&(['messages','schedule','templates','absence','accountants'] as string[]).includes(section)&&<TeamPanel organizationId={org} section={section as TeamSection}/>}
    {section==='settings'&&agencyProfile?.ops.includes('profile')&&<AgencyProfile key={org} organizationId={org} onSaved={setAgencyName}/>}
    {section==='settings'&&publicAgency&&uses('workerProvisioning')&&<AgencyNipVisibility key={org} organizationId={org}/>}
    {!production&&section==='home'&&<>
     {worker&&where.state?.offerWorkerPassword===true&&<WorkerPasswordPanel onDismiss={()=>navigate(where.pathname+where.search,{replace:true,state:null})}/>}
     {worker&&<WorkerCalendar key={org+access.membership.id} organizationId={org} membershipId={access.membership.id}/>}
     <section className="dashboard-panel">
      <div className="panel-heading"><h2>{t('workspaceRead.worksites')}</h2></div>
      {access.worksites.length?<ul className="factory-summary-list hosted-site-list">{access.worksites.map(site=><li className="factory-summary-row" key={site.id}><span className="factory-summary-icon"><Building2 size={16} aria-hidden="true"/></span><strong>{publicAgency?<Link to={root+'/setup?site='+site.id}>{site.name}</Link>:site.name}</strong></li>)}</ul>:<p>{t('workspaceRead.empty')}</p>}
     </section>
     <div className="form-actions agency-overview-actions">{menu.filter(x=>x.section==='timecards'||x.section==='payslips'||x.section==='workers').map(x=><Link key={x.section} className="button button--outline button--small" to={route(x.section)}>{t(x.label)}</Link>)}</div>
    </>}
    {directory&&<AgencyWorkersPanel key={org+(agencySearch.get('site')??'')} organizationId={org} siteId={agencySearch.get('site')??undefined} initialSection={agencySearch.get('tab')==='applications'?'applications':'roster'} enrollmentEnabled={uses('worker')} provisioningEnabled={publicAgency&&uses('workerProvisioning')} productionsEnabled={agencyProfile?.productions===true} factoryHoursEnabled={uses('factoryTimecards')} namesEnabled={uses('names')} lifecycleEnabled={uses('account')}/>}
    {!production&&!directory&&uses('worker')&&section==='workers'&&<AgencyWorkerPanel organizationId={org} verifiedAgency={publicAgency} namesEnabled={uses('names')} lifecycleEnabled={uses('account')}/> }
    {!production&&section==='setup'&&(publicAgency?<AgencyProductions key={org} organizationId={org} initialSites={access.worksites} enabled={agencyProfile?.productions===true} factoryInvites={uses('registration')} settingsEnabled={uses('profile')} namesEnabled={uses('names')} placementsEnabled={uses('factoryTimecards')}/>:loadModules?<FactorySetupPanel organizationId={org}/>:null)}
    {unifiedHours&&<AgencyTimecardsPanel key={section} organizationId={org} internalEnabled={uses('timecards')} factoryEnabled={uses('factoryTimecards')} initialSource={section==='factory-timecards'?'factory':'internal'}/>}
    {!unifiedHours&&uses('timecards')&&section==='timecards'&&<TimecardsPanel organizationId={org} includeFactoryArchive={uses('factoryTimecards')} readOnlyWorker={!agency}/> }
    {!production&&!unifiedHours&&uses('factoryTimecards')&&section==='factory-timecards'&&<FactoryTimecardsPanel organizationId={org} readOnlyWorker={worker}/>}
    {uses('payroll')&&section==='payslips'&&<PayslipsPanel organizationId={org}/>}
   </main>
  </div>

 </div>;
}


function CabinetSignOut(){
 const {t}=useTranslation(),navigate=useNavigate();
 const client=useMemo(()=>createWorkingRegistrationClient(window.location.origin,window.fetch.bind(window),'existing'),[]);
 const [allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  void client.context(controller.signal).then(scope=>{
   if(!controller.signal.aborted)setAllowed(scope?.state==='verified'&&scope.capabilities.logout);
  });
  return()=>{controller.abort();pending.current?.abort()};
 },[client]);
 if(!allowed)return null;
 async function signOut(){
  if(pending.current)return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setFailed(false);
  try{
   const ok=await client.logout(controller.signal);
   if(!controller.signal.aborted){if(ok)navigate('/login',{replace:true});else setFailed(true)}
  }finally{if(!controller.signal.aborted){pending.current=null;setBusy(false)}}
 }
 return <><button className="button button--outline button--small" type="button" disabled={busy} onClick={()=>void signOut()}>{t('agencyProductions.signOut')}</button>{failed&&<span role="status">{t('workspaceRead.unavailable')}</span>}</>;
}
