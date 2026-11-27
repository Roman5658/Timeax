import {AgencyProductions} from './AgencyProductions';
import {TeamBell,TeamPanel,type TeamSection} from './TeamWorkflow';

import { Building2, CalendarDays, ClipboardList, LayoutDashboard, Menu, Settings2, UsersRound, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

type Section = TeamSection | 'home' | 'workers' | 'setup' | 'timecards' | 'factory-timecards' | 'payslips';
type Item = {section: Section; label: string; group: 'workspace'|'people'|'operations'|'reports'; Icon: typeof LayoutDashboard};
const item = (section: Section, label: string, group: Item['group'], Icon: Item['Icon']): Item => ({section, label, group, Icon});
const agencyMenu = [
 item('home','nav.agencyHome','workspace',LayoutDashboard),
 item('setup','nav.productions','people',Building2),
 item('workers','nav.workers','people',UsersRound),
 item('timecards','nav.timekeeping','operations',CalendarDays),
 item('factory-timecards','factoryHours.title','reports',ClipboardList),
 item('payslips','canonicalPayslips.title','reports',ClipboardList),
 item('messages','team.messages','operations',ClipboardList),
 item('schedule','team.schedule','operations',CalendarDays),
];
agencyMenu.push(item('accountants','team.accountants','people',UsersRound));
const workerMenu = [
 item('home','nav.workerHome','workspace',LayoutDashboard),
 item('timecards','nav.shifts','operations',CalendarDays),
 item('factory-timecards','factoryHours.title','operations',Building2),
 item('payslips','canonicalPayslips.title','reports',ClipboardList),
 item('messages','team.messages','operations',ClipboardList),
 item('schedule','team.schedule','operations',CalendarDays),
];
workerMenu.push(item('templates','team.templates','operations',ClipboardList),item('absence','team.absence','operations',CalendarDays));
export function HostedCabinetRoute({organizationId, section, fallback}:{organizationId:string; section:Section; fallback:ReactNode}){
 const {t}=useTranslation();
 const [status,setStatus]=useState<WorkspaceResult>();
 useEffect(()=>{
  const controller=new AbortController();
  void loadWorkspaceAccess(organizationId,location.origin,window.fetch.bind(window),controller.signal).then(result=>{
   if(!controller.signal.aborted)setStatus(result);
  });
  return()=>controller.abort();
 },[organizationId]);
 if(!status)return <main className="portal-content"><p role="status">{t('workspaceRead.checking')}</p></main>;
 if(status.state!=='ready' || !['agency_admin','worker'].includes(status.value.membership.role) || status.value.organization.kind!=='agency')return fallback;
 const menu=status.value.membership.role==='agency_admin'?agencyMenu:workerMenu;
 if(!menu.some(entry=>entry.section===section))return fallback;
 return <HostedCabinet access={status.value} section={section} menu={menu}/>;
}

function HostedCabinet({access,section,menu}:{access:WorkspaceAccess; section:Section; menu:Item[]}){
 const {t}=useTranslation();
 const [menuOpen,setMenuOpen]=useState(false);
 const agency=access.membership.role==='agency_admin';
 const [agencyProfile,setAgencyProfile]=useState<{public:boolean;productions:boolean}>();
 useEffect(()=>{
  if(!agency)return;
  const c=new AbortController();
  void fetch('/v1/session/timeax-email',{credentials:'same-origin',cache:'no-store',signal:c.signal}).then(async r=>r.ok?await r.json():null).then(v=>{
   if(!c.signal.aborted)setAgencyProfile({public:v?.selfService===true,productions:v?.agencyProductions===true});
  }).catch(()=>{if(!c.signal.aborted)setAgencyProfile({public:true,productions:false})});
  return()=>c.abort();
 },[agency,access.organization.id]);
 const publicAgency=agency&&agencyProfile?.public===true;
 const loadModules=!agency||agencyProfile?.public===false;
 const root='/workspace/'+access.organization.id;
 const route=(id:Section)=>root+(id==='home'?'':'/'+id);
 const home=t(agency?'nav.agencyHome':'nav.workerHome');
 const heading=menu.find(entry=>entry.section===section)?.label??menu[0].label;
 const org=access.organization.id;
 const {label,organizationLabel}=useMemberNames(agency?undefined:org);
 useEffect(()=>{
  if(!menuOpen)return;
  const dismiss=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenuOpen(false)};
  window.addEventListener('keydown',dismiss);
  return()=>window.removeEventListener('keydown',dismiss);
 },[menuOpen]);
 return <div className={'portal-layout hosted-cabinet portal-layout--'+(agency?'agency':'worker')}>
  {menuOpen&&<button className="portal-sidebar-backdrop" type="button" aria-label={t('common.closeMenu')} onClick={()=>setMenuOpen(false)}/>}
  <aside id="hosted-cabinet-menu" className={'portal-sidebar'+(menuOpen?' is-open':'')}>
   <BrandMark/>
   <button className="portal-mobile-close" type="button" aria-label={t('common.closeMenu')} onClick={()=>setMenuOpen(false)}><X size={18}/></button>
   <div className="sidebar-divider"/>
   <nav className="portal-nav" aria-label={home}>
    {menu.map(({section:id,label,group,Icon},index)=><Fragment key={id}>
     {group!==menu[index-1]?.group&&<div className="portal-nav-group-label">{t('nav.groups.'+group)}</div>}
     <Link className={'portal-nav-link'+(id===section?' is-active':'')} aria-current={id===section?'page':undefined} to={route(id)} onClick={()=>setMenuOpen(false)}><Icon size={17} aria-hidden="true"/><span>{t(label)}</span></Link>
    </Fragment>)}
    {!agency&&<><div className="portal-nav-group-label">{t('nav.groups.account')}</div><Link className="portal-nav-link" to="/account"><Settings2 size={17} aria-hidden="true"/><span>{t('nav.profile')}</span></Link><Link className="portal-nav-link" to="/register/worker"><Building2 size={17} aria-hidden="true"/><span>{t('workerEnrollment.join')}</span></Link></>}
   </nav>
   <div className="sidebar-spacer"/>
   {agency&&<CabinetSignOut simple/>}
   <div className="sidebar-user"><span className="sidebar-avatar"><UsersRound size={16} aria-hidden="true"/></span><span><strong>{t('workspaceRead.'+access.membership.role)}</strong>{!agency&&<small>{label(access.membership.id)}</small>}</span></div>
  </aside>
  <div className="portal-main-column">
   <header className="portal-topline">
    <div className="portal-topline-left">
     <button className="portal-mobile-menu" type="button" aria-controls="hosted-cabinet-menu" aria-label={t('common.openMenu')} aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}><Menu size={19}/></button>
     <div className="portal-breadcrumb"><span className="breadcrumb-dot"/>{home}</div>
    </div>
    <div className="portal-top-actions">{loadModules&&<TeamBell organizationId={org}/>}
    {!agency&&<CabinetSignOut/>}<LanguageSwitcher compact/><ThemeToggle/></div>
   </header>
   <main className="portal-content">
    <PageHeading eyebrow={!agency?organizationLabel(access.membership.id):undefined} title={t(heading)} />
    {publicAgency&&section!=='home'&&section!=='setup'&&<p className="notice-box" role="status">{t('agencyProductions.moduleNotEnabled')}</p>}
    {loadModules&&(['messages','schedule','templates','absence','accountants'] as string[]).includes(section)&&<TeamPanel organizationId={org} section={section as TeamSection}/>}
    {section==='home'&&<>
     <section className="dashboard-panel">
      <div className="panel-heading"><h2>{t('workspaceRead.worksites')}</h2></div>
      {access.worksites.length?<ul className="factory-summary-list hosted-site-list">{access.worksites.map(site=><li className="factory-summary-row" key={site.id}><span className="factory-summary-icon"><Building2 size={16} aria-hidden="true"/></span><strong>{site.name}</strong></li>)}</ul>:<p>{t('workspaceRead.empty')}</p>}
     </section>
     <div className="form-actions agency-overview-actions">{menu.filter(x=>x.section==='timecards'||x.section==='payslips'||x.section==='workers').map(x=><Link key={x.section} className="button button--outline button--small" to={route(x.section)}>{t(x.label)}</Link>)}</div>
    </>}
    {loadModules&&section==='workers'&&<AgencyWorkerPanel organizationId={org}/>}
    {section==='setup'&&(publicAgency?<AgencyProductions key={org} organizationId={org} initialSites={access.worksites} enabled={agencyProfile?.productions===true}/>:loadModules?<FactorySetupPanel organizationId={org}/>:null)}
    {loadModules&&section==='timecards'&&<TimecardsPanel organizationId={org}/>}
    {loadModules&&section==='factory-timecards'&&<FactoryTimecardsPanel organizationId={org}/>}
    {loadModules&&section==='payslips'&&<PayslipsPanel organizationId={org}/>}
   </main>
  </div>

 </div>;
}


function CabinetSignOut({simple=false}:{simple?:boolean}){
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
 return <><button className="button button--outline button--small" type="button" disabled={busy} onClick={()=>void signOut()}>{t(simple?'agencyProductions.signOut':'existingSession.logout')}</button>{failed&&<span role="status">{t('workspaceRead.unavailable')}</span>}</>;
}
