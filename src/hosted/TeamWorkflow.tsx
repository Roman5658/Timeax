import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Bell,Plus,Send,X} from 'lucide-react';
import {RegistrationFrame} from '../components/PublicExperience';
import {useMemberNames} from './MemberNames';
import {teamCall,useTeam,changed,type ShiftTemplate,type TeamEntry} from './team-workflow';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {cleanTeamDay,eligibleTeamRecipients,warsawTeamDay,type TeamAudience} from './team-communication';
import {groupInboxConversations,indexMessageThreads,unreadInboxMessageIds} from './team-message-threads';
import {teamCommunicationCopy} from './team-communication-copy';
import {workerScheduleRows} from './worker-schedule.ts';
import {AgencySchedule} from './AgencySchedule';
import {WorkerTemplateDrawer} from './WorkerTemplateDrawer';
import {inboxPage,inboxPageSize,type Inbox} from './inbox';
import {InboxActions,InboxPagination,useInboxCopy} from './InboxControls';
import {bellTarget,latestBellPreviews,noticeDestination,previewText,useBellAnchor,type BellPreview} from './notification-navigation';
import '../styles/team-workflow.css';
export type TeamSection='messages'|'schedule'|'templates'|'absence'|'accountants';
const workerHelp={
 en:{noSite:'To report an absence here, you need an assigned production site. You can message your agency in the meantime.',fill:'Fill in from a shift template'},
 ru:{noSite:'Прежде чем сообщить об отсутствии здесь, нужно быть назначенным на производство. Пока можно написать своему агентству.',fill:'Заполнить по шаблону смены'},
 pl:{noSite:'Aby zgłosić nieobecność tutaj, musisz mieć przypisane miejsce pracy. W międzyczasie możesz napisać do agencji.',fill:'Uzupełnij z szablonu zmiany'},
 uk:{noSite:'Щоб повідомити про відсутність тут, потрібно мати призначене виробництво. Поки можна написати своїй агенції.',fill:'Заповнити за шаблоном зміни'},
};
const localized=(language:string|undefined)=>workerHelp[(language??'en').split('-')[0] as keyof typeof workerHelp]??workerHelp.en;
export function TeamBell({organizationId,additionalUnread=0,additional=[],inboxState}:{organizationId:string;additionalUnread?:number;additional?:BellPreview[];inboxState?:Inbox}){
 const {t,i18n}=useTranslation(),{value,refresh}=useTeam(organizationId),route=useLocation();
 const [expanded,setExpanded]=useState(false),wrap=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panelId=useId();
 const {label}=useMemberNames(expanded?organizationId:undefined);
 const [page,setPage]=useState(0),root='/workspace/'+organizationId+'/',inbox=root+'messages';
 const inboxLoading=inboxState?.enabled===true&&!inboxState.data;
 const isVisible=(anchor:string)=>anchor.startsWith('earlier-shift-')||!inboxLoading&&(!inboxState||inboxState.state(anchor)==='active');
 const teamRows=(value?.entries??[]).filter(e=>!e.outgoing);
 const count=Math.max(0,(value?.unread??0)-teamRows.filter(e=>!e.read&&!isVisible((e.kind==='message'?'team-message-':'team-notice-')+e.id)).length)+additionalUnread;
 const previews=expanded?latestBellPreviews([...additional,...teamRows.map(e=>{
  const peer=value?.recipients.find(r=>r.id===e.sender);
  const sender=peer?.role==='worker'?label(e.sender):peer?.organizationName||t('team.sender');
  const title=e.kind==='message'?sender:t('team.'+e.kind)+' · '+sender;
  const summary=e.kind==='message'?[previewText(e.payload.subject),previewText(e.payload.text)].filter(Boolean).join(' · '):
     e.kind==='absence'?[e.payload.dateFrom,e.payload.dateTo].filter(Boolean).join(' – '):[e.payload.localDate,e.payload.startTime,e.payload.endTime].filter(Boolean).join(' · ');
  return {anchor:(e.kind==='message'?'team-message-':'team-notice-')+e.id,title,summary,at:e.createdAt,unread:!e.read};
 })].filter(p=>isVisible(p.anchor))):[];
 const currentPage=inboxPage(previews,page);
 useEffect(()=>setExpanded(false),[route.key,organizationId]);
 useEffect(()=>{
  if(!expanded)return;
  const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!wrap.current?.contains(e.target))setExpanded(false)};
  const keyboard=(e:KeyboardEvent)=>{if(e.key==='Escape'){setExpanded(false);trigger.current?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard)};
 },[expanded]);
 return <div ref={wrap} className="team-bell-wrap"><button ref={trigger} className="button button--outline button--small team-bell" type="button"
  aria-expanded={expanded} aria-controls={panelId} onClick={()=>{if(!expanded){setPage(0);refresh();inboxState?.refresh()}setExpanded(!expanded)}}
  aria-label={t('team.notifications',{count})}><Bell size={19} aria-hidden="true"/>{count>0&&<span aria-hidden="true">{count}</span>}</button>
 {expanded&&<section className="team-bell-popover" id={panelId} aria-label={t('workflow.notifications.title')}>
  <h2>{t('workflow.notifications.title')}</h2>
  {previews.length>0?<ul>{currentPage.rows.map(p=><li key={p.anchor}><Link className="team-bell-preview" data-unread={p.unread}
   to={root+noticeDestination(p.anchor)+'#'+p.anchor} onClick={()=>setExpanded(false)}>
   <strong>{p.title}</strong>{p.summary&&<span>{previewText(p.summary)}</span>}
   <time dateTime={p.at}>{new Date(p.at).toLocaleString(i18n.resolvedLanguage)}</time>
  </Link></li>)}</ul>:<p role="status">{t(value?'workflow.notifications.empty':'team.loading')}</p>}
  <InboxPagination page={currentPage.page} pages={currentPage.pages} onPage={setPage}/>
  <Link to={inbox} onClick={()=>setExpanded(false)}>{t('team.messages')}</Link>
 </section>}</div>;
}
export function TemplatePicker({organizationId,onApply,disabled}:{organizationId:string;onApply:(v:ShiftTemplate['data'])=>void;disabled:boolean}){
 const {t,i18n}=useTranslation(),{value}=useTeam(organizationId);
 if(value?.role!=='worker')return null;
 const hint=localized(i18n.resolvedLanguage).fill;
 return <div className="team-quick-templates" aria-label={hint}>
  {value.templates.length>0&&<p>{hint}</p>}
  <div className="form-actions">{value.templates.map(v=><button className="button button--outline button--small" type="button" key={v.id}
   title={v.data.startTime+'–'+v.data.endTime} disabled={disabled} onClick={()=>onApply(v.data)}>{v.name}</button>)}
   <Link to={'/workspace/'+organizationId+'/templates'}>{t('team.templates')}</Link>
  </div>
 </div>;
}
export function TeamStandalone({organizationId,section}:{organizationId:string;section:TeamSection}){
 const {t}=useTranslation();return <RegistrationFrame title={t('team.'+section)} lead={t('team.scope')}><TeamBell organizationId={organizationId}/><TeamPanel organizationId={organizationId} section={section}/><Link to={'/workspace/'+organizationId}>{t('team.back')}</Link></RegistrationFrame>;
}
type ExternalNotice={anchor:string;at:string;card:()=>ReactNode};
export function TeamPanel({organizationId,section,initialDay,compact=false,notificationExtras,externalNotices=[],inboxState}:{organizationId:string;section:TeamSection;initialDay?:string;compact?:boolean;notificationExtras?:ReactNode;externalNotices?:ExternalNotice[];inboxState?:Inbox}){
 const {t,i18n}=useTranslation(),tx=(k:string)=>t('team.'+k),{value,error,refresh}=useTeam(organizationId),{label}=useMemberNames(organizationId);
 const workerCopy=localized(i18n.resolvedLanguage),copy=teamCommunicationCopy(i18n.resolvedLanguage),route=useLocation();
 useBellAnchor(section==='messages');
 const absenceDay=section==='absence'?(cleanTeamDay(initialDay??null)||cleanTeamDay(new URLSearchParams(route.search).get('date'))):'';
 const [compose,Compose]=useState(false),[audience,SetAudience]=useState<TeamAudience>('workers'),[folder,Folder]=useState<'inbox'|'sent'|'unread'|'archived'>('inbox');
 const inboxCopy=useInboxCopy(),inboxLoading=inboxState?.enabled===true&&!inboxState.data;
 const [noticeFolder,setNoticeFolder]=useState<'active'|'archived'>('active'),[noticePage,setNoticePage]=useState(0);
 const [replyTo,ReplyTo]=useState<TeamEntry>(),[subject,Subject]=useState('');
 const [busy,B]=useState(false),[notice,N]=useState(''),[site,S]=useState(''),[selected,C]=useState<string[]>([]),[body,T]=useState(''),[opened,O]=useState<string[]>([]),[conversation,Conversation]=useState<string>();
 const [date,D]=useState(()=>absenceDay||warsawTeamDay()),[until,U]=useState(date),[start,A]=useState('08:00'),[end,Z]=useState('16:00');
 const [edit,E]=useState<TeamEntry>(),[template,ET]=useState<ShiftTemplate>(),[templateOpen,setTemplateOpen]=useState(false),[email,EM]=useState(''),[invite,I]=useState('');
 const sending=useRef(false);
 const op=useRef(crypto.randomUUID());const dirty=()=>{op.current=crypto.randomUUID();N('')};
 useEffect(()=>{E(undefined);ET(undefined);setTemplateOpen(false);C([]);T('');O([]);Conversation(undefined);I('');N('');S('');ReplyTo(undefined);Subject('');Compose(false);Folder('inbox');setNoticeFolder('active');setNoticePage(0);dirty()},[organizationId,section]);
 useEffect(()=>{if(section==='absence'){const next=absenceDay||warsawTeamDay();D(next);U(next);E(undefined);dirty()}},[section,organizationId,absenceDay]);
 async function run(action:string,data:Record<string,unknown>){if(sending.current)return;sending.current=true;B(true);N('');try{
  const r=await teamCall(organizationId,action,{...data,...(action==='read'?{}:{operationId:op.current})});
  if(action==='invite-accountant')I(location.origin+'/accountant/invitation#invite='+r.code);
  if(action==='read'){O(a=>[...a,String(data.id)]);if(folder==='unread')Folder('inbox');}
  if(action==='message'){Compose(false);ReplyTo(undefined);Subject('');C([]);if(!replyTo){Conversation(undefined);Folder('sent');}}
  else {T('');E(undefined);N('saved');op.current=crypto.randomUUID()}
  changed();
 }catch(e){N((e as Error).message);refresh()}finally{sending.current=false;B(false)}}
 function editPlan(e:TeamEntry){E(e);S(e.siteId??'');C(e.recipients??[]);D(String(e.payload.localDate??e.payload.dateFrom));U(String(e.payload.dateTo??e.payload.localDate));A(String(e.payload.startTime??'08:00'));Z(String(e.payload.endTime??'16:00'));dirty()}
 const siteInput=(required=false)=><label className="field-label">{t('timecards.site')}<select value={site} required={required} disabled={busy||!!edit} onChange={e=>{S(e.target.value);if(section==='schedule')C([]);dirty()}}><option value="">{tx('choose')}</option>{value?.sites.filter(w=>section!=='schedule'||w.canPlan).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>;
 const person=(id:string)=>{const r=value?.recipients.find(x=>x.id===id);return r?.role==='worker'?label(id):r?t('workspaceRead.'+r.role)+' · '+r.organizationName:tx('sender')};
 const workerFactoryRecipient=value?.factoryChat===true&&value.recipients.some(r=>r.role==='factory_admin'&&r.worksiteIds.length);
 const workerAgencyRecipient=value?.recipients.some(r=>r.role==='agency_admin'&&r.organizationId===organizationId);
 const isFactoryAdmin=value?.role==='factory_admin'&&value.factoryChat===true;
 const messageAudiences:TeamAudience[]=value?.role==='worker'?
  [...(workerAgencyRecipient?['agency' as const]:[]),'leader',...(workerFactoryRecipient?['factory' as const]:[])]:
  isFactoryAdmin?['workers']:value?.role==='team_leader'?['workers','agency']:['workers','production','leader'];
 const capable=Boolean(value&&(['worker','agency_admin','team_leader'].includes(value.role)||isFactoryAdmin));
 const modeTitle=(mode:TeamAudience)=>isFactoryAdmin&&mode==='workers'?t('factorySubscription.chooseWorker'):
  t('workflow.messagesCenter.'+({agency:'toAgency',workers:'selectedWorkers',production:'allProduction',leader:'toLeader',factory:'toFactory'}[mode]));
 const sites=value?.sites??[];
 const replyPeers=value&&isFactoryAdmin&&replyTo&&value.messageThreads&&sites.some(s=>s.id===site)
  ?value.recipients.filter(r=>r.id===replyTo.sender&&r.role==='worker'&&r.worksiteIds.includes(site)):undefined;
 const filteredRecipients=replyPeers??(value?eligibleTeamRecipients(value,audience,site).filter(r=>!replyTo||r.id===replyTo.sender):[]);
 const recipients=audience==='production'?filteredRecipients.map(r=>r.id):selected.filter(id=>filteredRecipients.some(r=>r.id===id));
 const draftHasSite=audience==='leader'||audience==='production'||audience==='factory'||value?.role==='team_leader'||isFactoryAdmin;
 const allowMulti=audience==='workers'&&!isFactoryAdmin;
 function setAudience(mode:TeamAudience){
  SetAudience(mode);C([]);S(mode==='agency'&&value?.role==='worker'||mode==='workers'&&value?.role==='agency_admin'?'':sites.length===1?sites[0].id:'');dirty();
 }
 function newMessage(){
  ReplyTo(undefined);Subject('');T('');Compose(true);setAudience(value?.role==='worker'?(workerAgencyRecipient?'agency':workerFactoryRecipient?'factory':'leader'):'workers');
 }
 function responseMode(entry:TeamEntry){
  const target=value?.recipients.find(r=>r.id===entry.sender);
  if(!target)return null;
  const mode:TeamAudience=target.role==='agency_admin'?'agency':target.role==='team_leader'?'leader':target.role==='factory_admin'?'factory':'workers';
  const requireSite=mode==='leader'||mode==='factory'||value?.role==='team_leader'||isFactoryAdmin;
  const chosen=requireSite?(entry.siteId??(sites.length===1?sites[0].id:'')):'';
  const factoryReply=isFactoryAdmin&&value?.messageThreads&&entry.siteId===chosen&&target.role==='worker'&&
   target.worksiteIds.includes(chosen)&&sites.some(s=>s.id===chosen);
  return factoryReply||value&&eligibleTeamRecipients(value,mode,chosen).some(r=>r.id===target.id)?{target,mode,chosen}:null;
 }
 function reply(entry:TeamEntry){
  const next=responseMode(entry);
  if(!next)return;
  ReplyTo(entry);Compose(true);SetAudience(next.mode);S(next.chosen);C([next.target.id]);T('');Subject(typeof entry.payload.subject==='string'?entry.payload.subject:'');dirty();
 }
 const threads=useMemo(()=>indexMessageThreads(value?.messageThreads&&section==='messages'?value.entries:[]),[value,section]);
 const conversations=useMemo(()=>groupInboxConversations(value?.entries??[],threads),[value,threads]);
 const visibleConversations=(inboxLoading?[]:conversations).map(group=>({...group,messages:group.messages.filter(e=>(inboxState?.state('team-message-'+e.id)??'active')===(folder==='archived'?'archived':'active'))})).filter(group=>group.messages.length);
 const openConversation=visibleConversations.find(group=>group.id===conversation);
 const readPending=useRef(new Set<string>());
 const [readError,setReadError]=useState<string>();
 useEffect(()=>{const scope=new Set<string>();readPending.current=scope;setReadError(undefined);O([]);Conversation(undefined);return()=>{if(readPending.current===scope)readPending.current=new Set<string>()}},[organizationId,section,value?.membershipId]);
 const viewConversation=(group:typeof conversations[number],force=false)=>{
  if(conversation===group.id&&!force){Conversation(undefined);return}
  Conversation(group.id);setReadError(undefined);
  const ids=unreadInboxMessageIds(group.messages,opened).filter(id=>!readPending.current.has(id));
  if(!ids.length)return;
  const pending=readPending.current;ids.forEach(id=>pending.add(id));
  void Promise.allSettled(ids.map(async id=>{await teamCall(organizationId,'read',{id});return id})).then(results=>{
   ids.forEach(id=>pending.delete(id));
   if(readPending.current!==pending)return;
   const done=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
   if(done.length){O(current=>[...new Set([...current,...done])]);changed()}
   if(done.length!==ids.length)setReadError(group.id);
  });
 };
 const linked=useRef<string>(undefined);
 useEffect(()=>{
  const anchor=bellTarget(route.hash);
  if(section!=='messages'||inboxLoading||!anchor?.startsWith('team-message-')||linked.current===route.key)return;
  const selected=conversations.find(g=>g.messages.some(m=>'team-message-'+m.id===anchor));
  if(!selected)return;
  linked.current=route.key;
  const state=inboxState?.state(anchor)??'active';
  if(state==='deleted')return;
  const messages=selected.messages.filter(m=>(inboxState?.state('team-message-'+m.id)??'active')===state);
  Folder(state==='archived'?'archived':messages.some(m=>!m.outgoing)?'inbox':'sent');viewConversation({...selected,messages},true);
 },[route.hash,route.key,section,conversations,inboxLoading,inboxState?.data?.states]);
 const messageUnread=inboxLoading?0:value?.entries.filter(e=>e.kind==='message'&&!e.outgoing&&!e.read&&!opened.includes(e.id)&&(inboxState?.state('team-message-'+e.id)??'active')==='active').length??0;
 const visibleEntries=value?.entries.filter(v=>section==='messages'
  ?v.kind!=='message'
  :v.kind===(section==='schedule'?'schedule':'absence'))??[];
 const workerSchedule=section==='schedule'&&value?.role==='worker';
 const allNotices:ExternalNotice[]=section==='messages'&&!inboxLoading?[...visibleEntries.map(e=>({anchor:'team-notice-'+e.id,at:e.createdAt,card:()=>noticeCard(e,true)})),...externalNotices]
  .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.anchor.localeCompare(b.anchor)):[];
 const listedNotices=allNotices.filter(p=>(inboxState?.state(p.anchor)??'active')===noticeFolder);
 const noticeAnchor=useRef<string|undefined>(undefined);
 useEffect(()=>{
  if(section!=='messages'||noticeAnchor.current===route.key)return;
  const anchor=bellTarget(route.hash),found=allNotices.find(v=>v.anchor===anchor);
  if(!found)return;
  const state=inboxState?.state(found.anchor)??'active';
  if(state==='deleted')return;
  noticeAnchor.current=route.key;
  setNoticeFolder(state);
  setNoticePage(Math.floor(allNotices.filter(p=>(inboxState?.state(p.anchor)??'active')===state).findIndex(p=>p.anchor===anchor)/inboxPageSize));
 },[section,route.key,route.hash,allNotices,inboxState?.data?.states]);
 const noticeSlice=inboxPage(listedNotices,noticePage);
 const choices=(workersOnly=false)=><fieldset disabled={busy||!!edit}><legend>{tx('recipients')}</legend><div className="team-recipients">{value?.recipients.filter(x=>!workersOnly||x.role==='worker'&&x.worksiteIds.includes(site)).map(r=><label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e=>{C(a=>e.target.checked?[...a,r.id]:a.filter(x=>x!==r.id));dirty()}}/>{person(r.id)}</label>)}</div><small>{tx('recipientScope')}</small></fieldset>;
 const dates=<div className="timecards-pair"><label className="field-label">{tx('from')}<input type="date" required value={date} onChange={e=>{D(e.target.value);if(e.target.value>until)U(e.target.value);dirty()}}/></label><label className="field-label">{tx('to')}<input type="date" required min={date} value={until} onChange={e=>{U(e.target.value);dirty()}}/></label></div>;
 const times=<div className="timecards-pair"><label className="field-label">{t('timecards.start')}<input type="time" required value={start} onChange={e=>{A(e.target.value);dirty()}}/></label><label className="field-label">{t('timecards.end')}<input type="time" required value={end} onChange={e=>{Z(e.target.value);dirty()}}/></label></div>;
 return <section className="worker-enrollment team-panel" aria-busy={busy}>
 {!value?<p role="status">{tx(error||'closed')}</p>:<>
 {section==='messages'&&<section className="dashboard-panel team-conversations" aria-label={tx('messages')}>
 <h2>{tx('messages')}</h2>
 <div className="form-actions team-message-tools">
 {capable&&<button className="button button--primary" type="button" onClick={newMessage}><Send size={16} aria-hidden="true"/>{copy.open}</button>}

 </div>
 <div className="form-actions team-message-folders" role="group" aria-label={copy.filters}>
 {(['inbox','sent','unread','archived'] as const).filter(v=>v!=='archived'||!!inboxState?.data).map(v=><button className={'button button--small '+(folder===v?'button--primary':'button--outline')} key={v} type="button" disabled={busy}
  aria-pressed={folder===v} onClick={()=>{Folder(v);Conversation(undefined);setReadError(undefined)}}>{v==='archived'?inboxCopy.archived:copy[v]}{v==='unread'&&messageUnread>0?' ('+messageUnread+')':''}</button>)}
 </div>
 {compose&&capable&&<AgencyBookDrawer title={replyTo?copy.replying.replace('{{name}}',person(replyTo.sender)):copy.compose} closeLabel={t('common.close')} busy={busy} onClose={()=>{Compose(false);ReplyTo(undefined);N('')}}>
  <form className="auth-form team-message-compose" onSubmit={e=>{
   e.preventDefault();if(!recipients.length||recipients.length>100||!body.trim())return;
   void run('message',{siteId:value.messageThreads&&replyTo?replyTo.siteId:draftHasSite?site:null,recipients,payload:{
    text:body.trim(),...(value.messageThreads&&subject.trim()?{subject:subject.trim()}:{}),...(value.messageThreads&&replyTo?{replyTo:replyTo.id}:{})
   }});
  }}>
   {!replyTo&&!isFactoryAdmin&&<label className="field-label">{copy.fields}<select value={audience} disabled={busy} onChange={e=>setAudience(e.target.value as TeamAudience)}>
    {messageAudiences.filter(m=>m!=='leader'||value.recipients.some(r=>r.role==='team_leader'&&(r.worksiteIds.length||sites.length===1))).map(m=><option key={m} value={m}>{modeTitle(m)}</option>)}
   </select></label>}
   {draftHasSite&&!replyTo&&<label className="field-label">{t('timecards.site')}<select required value={site} disabled={busy} onChange={e=>{S(e.target.value);C([]);dirty()}}>
    <option value="">{tx('choose')}</option>{sites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
   </select></label>}
   {filteredRecipients.length===0?<p className="notice-box">{t('workflow.messagesCenter.noRecipients')}</p>:
    <fieldset disabled={busy||!!replyTo}><legend>{copy.defaultSend}</legend>
     {allowMulti&&!replyTo&&<div className="form-actions"><button className="button button--outline button--small" type="button" disabled={filteredRecipients.length>100}
       onClick={()=>{C(filteredRecipients.map(r=>r.id));dirty()}}>{copy.all}</button><button className="button button--outline button--small" type="button"
       onClick={()=>{C([]);dirty()}}>{copy.none}</button></div>}
     <div className="team-recipients">{filteredRecipients.map(r=>audience==='production'?<p key={r.id}>{person(r.id)}</p>:<label key={r.id}>
       <input type={allowMulti?'checkbox':'radio'} name={'recipient-'+organizationId} disabled={!recipients.includes(r.id)&&recipients.length>=100}
        checked={recipients.includes(r.id)} onChange={e=>{C(a=>allowMulti?(e.target.checked?[...a,r.id]:a.filter(x=>x!==r.id)):[r.id]);dirty()}}/>{person(r.id)}</label>)}</div>
     <small>{recipients.length>100?copy.tooMany:copy.selection.replace('{{count}}',String(recipients.length))}</small>
    </fieldset>}
   {value.messageThreads&&<label className="field-label">{t('workflow.messagesCenter.subject')}<input maxLength={120} value={subject} disabled={busy} onChange={e=>{Subject(e.target.value);dirty()}}/></label>}
   <label className="field-label">{tx('message')}<textarea required maxLength={2000} rows={4} value={body} disabled={busy} onChange={e=>{T(e.target.value);dirty()}}/></label>
   <small>{tx('noSensitive')}</small><button type="submit" className="button button--primary" disabled={busy||!recipients.length||recipients.length>100||!body.trim()}>{tx('send')}</button>
   {notice&&<p role="alert">{tx(notice)}</p>}
  </form>
 </AgencyBookDrawer>}
 {section==='messages'&&(()=>{
  const read=(v:TeamEntry)=>v.outgoing||v.read||opened.includes(v.id);
  const listed=visibleConversations.filter(group=>folder==='archived'?true:folder==='sent'?group.messages.some(v=>v.outgoing):
   folder==='unread'?group.id===openConversation?.id||group.messages.some(v=>!read(v)):group.messages.some(v=>!v.outgoing));
  return <>{!listed.length&&<p className="muted-copy">{inboxLoading?t(inboxState?.failure?'team.closed':'team.loading'):copy.empty}</p>}
   {!!listed.length&&<ul className="team-inbox">{listed.map(group=>{
    const incoming=group.messages.filter(v=>!v.outgoing).at(-1);
    const outgoing=group.messages.filter(v=>v.outgoing).at(-1);
    const summary=(folder==='sent'?outgoing:incoming)??group.messages.at(-1)!;
    const who=summary.outgoing?(summary.recipients?.length===1?person(summary.recipients[0]):tx('you')):person(summary.sender);
    const subject=typeof summary.payload.subject==='string'?summary.payload.subject:'';
    const unread=group.messages.filter(v=>!read(v)).length;
    const active=group.id===conversation;
    const responder=group.messages.filter(v=>!v.outgoing&&responseMode(v)).at(-1);
    return <li key={group.id} className="team-inbox__item" data-unread={unread>0}>
     <button type="button" className="team-inbox__open" aria-expanded={active} aria-controls={'team-thread-'+group.id} onClick={()=>viewConversation(group)}>
      <strong>{who}</strong><time dateTime={summary.createdAt}>{new Date(summary.createdAt).toLocaleString()}</time>
      {subject&&<span className="team-inbox__subject">{subject}</span>}
      <span className="team-inbox__preview">{previewText(summary.payload.text)}</span>
      {unread>0&&<span className="team-inbox__unread">{tx('unread')} · {unread}</span>}
     </button>
     <div id={'team-thread-'+group.id} hidden={!active}>{active&&<>
      <ol className="team-inbox__messages">{group.messages.map(v=><li key={v.id} id={'team-message-'+v.id} tabIndex={-1} data-unread={!read(v)} className={v.outgoing?'team-inbox__bubble is-outgoing':'team-inbox__bubble'}>
       <div><strong>{v.outgoing?tx('you'):person(v.sender)}</strong> <time dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString()}</time></div>
       <p className="team-body">{String(v.payload.text)}</p>
       <InboxActions inbox={inboxState} anchor={'team-message-'+v.id}/>
      </li>)}</ol>
      {readError===group.id&&<p role="status">{tx('closed')}</p>}
      {responder&&<button type="button" className="button button--outline button--small" onClick={()=>reply(responder)}>{tx('reply')}</button>}
     </>}</div>
    </li>;
   })}</ul>}
  </>;
 })()}
 </section>}
 {section==='absence'&&value.role==='worker'&&!value.sites.length&&<p className="notice-box">{workerCopy.noSite} <Link to={'/workspace/'+organizationId+'/messages'}>{tx('messages')}</Link></p>}
 {section==='absence'&&value.role==='worker'&&!!value.sites.length&&<form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run(edit?'update-plan':'absence',{...(edit?{id:edit.id,revision:edit.revision}:{siteId:site}),payload:{dateFrom:date,dateTo:until}})}}>
 {!compact&&<h2>{tx('absence')}</h2>}<p>{tx('absenceHint')}</p>{siteInput(true)}{dates}<button className="button button--primary" disabled={busy||!site}>{tx(edit?'save':'send')}</button></form>}
 {section==='schedule'&&value.role==='agency_admin'&&<AgencySchedule key={organizationId} context={value} workerLabel={label}/>}
 {workerSchedule&&<WorkerSchedule entries={visibleEntries}/>}
 {section==='schedule'&&value.role==='team_leader'&&<><p className="notice-box">{tx('plannedOnly')}</p><form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run(edit?'update-plan':'schedule',{...(edit?{id:edit.id,revision:edit.revision}:{siteId:site,recipients:selected}),payload:{localDate:date,startTime:start,endTime:end}})}}>
 {siteInput(true)}{choices(true)}<label className="field-label">{t('timecards.date')}<input type="date" required value={date} onChange={e=>{D(e.target.value);dirty()}}/></label>{times}<p>{t('timecards.overnight')} · Europe/Warsaw</p><button className="button button--primary" disabled={busy||!site||!selected.length}>{tx(edit?'save':'plan')}</button></form></>}
 {section==='templates'&&value.role==='worker'&&<>
  <div className="form-actions team-template-tools">
   <button className="button button--primary" type="button" disabled={busy} onClick={()=>{ET(undefined);setTemplateOpen(true)}}><Plus size={16} aria-hidden="true"/>{t('workflow.templates.add')}</button>
   <Link className="button button--outline" to={'/workspace/'+organizationId} aria-label={t('common.close')+' · '+tx('back')}><X size={16} aria-hidden="true"/>{tx('back')}</Link>
  </div>
  {value.templates.map(v=><article className="notice-box" key={v.id}><h3>{v.name}</h3><p>{v.data.startTime}-{v.data.endTime} · {v.data.breakMinutes} {t('workerAccount.minutes')}</p><button type="button" className="button button--outline" disabled={busy} onClick={()=>{ET(v);setTemplateOpen(true)}}>{tx('edit')}</button> <button type="button" className="button button--outline" disabled={busy} onClick={()=>{if(window.confirm(tx('deleteConfirm'))){dirty();void run('delete-template',{id:v.id,revision:v.revision})}}}>{tx('delete')}</button></article>)}
  {templateOpen&&<WorkerTemplateDrawer organizationId={organizationId} template={template} onClose={()=>setTemplateOpen(false)}/>}
  <Link to={'/workspace/'+organizationId+'/timecards'}>{tx('useTemplate')}</Link>
 </>}
 {section==='accountants'&&value.role==='agency_admin'&&<><p>{tx('accountantHint')}</p><form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run('invite-accountant',{email})}}><label className="field-label">{tx('email')}<input type="email" required maxLength={254} value={email} onChange={e=>{EM(e.target.value);I('');dirty()}}/></label><button className="button button--primary" disabled={busy}>{tx('invite')}</button></form>
 {invite&&<div className="notice-box"><label className="field-label">{tx('inviteLink')}<input readOnly value={invite} onFocus={e=>e.target.select()}/></label><p>{tx('noMail')}</p><button className="button button--outline" onClick={()=>{void navigator.clipboard.writeText(invite).then(()=>N('copied')).catch(()=>N('copyManually'))}}>{tx('copy')}</button></div>}
 {value.invitations.map(v=><article className="notice-box" key={v.id}><strong>{v.email}</strong><p>{tx(v.state)} · {new Date(v.expiresAt).toLocaleString()}</p>{!['revoked','expired'].includes(v.state)&&<button className="button button--outline" disabled={busy} onClick={()=>{if(window.confirm(tx('revokeConfirm'))){dirty();void run('revoke-accountant',{id:v.id})}}}>{tx('revoke')}</button>}</article>)}</>}
 {edit&&<button className="button button--outline" onClick={()=>{E(undefined);dirty()}}>{tx('stopEditing')}</button>}
 {['messages','schedule','absence'].includes(section)&&!(section==='schedule'&&(value.role==='agency_admin'||workerSchedule))&&<>{section!=='messages'&&!compact&&<h2>{tx('history')}</h2>}

 {section==='messages'?<section className="dashboard-panel team-work-notices" aria-label={tx('workNotifications')}>
 <h2>{tx('workNotifications')}</h2>{notificationExtras}
 {inboxState?.data&&<div className="form-actions team-message-folders" role="group" aria-label={tx('workNotifications')}>
  {(['active','archived'] as const).map(f=><button key={f} type="button" className={'button button--small '+(noticeFolder===f?'button--primary':'button--outline')}
   aria-pressed={noticeFolder===f} onClick={()=>{setNoticeFolder(f);setNoticePage(0)}}>{inboxCopy[f]}</button>)}
 </div>}
 {inboxState?.failure&&<p role="alert">{inboxCopy.failed}</p>}
 {!noticeSlice.rows.length&&<p>{t(inboxLoading?'team.loading':'workflow.notifications.empty')}</p>}
 {noticeSlice.rows.map(p=><article className="notice-box" key={p.anchor} id={p.anchor} tabIndex={-1}>{p.card()}
    {!p.anchor.startsWith('team-notice-')&&<p><time dateTime={p.at}>{new Date(p.at).toLocaleString(i18n.resolvedLanguage)}</time></p>}
   <InboxActions inbox={inboxState} anchor={p.anchor}/></article>)}
 <InboxPagination page={noticeSlice.page} pages={noticeSlice.pages} onPage={setNoticePage}/>
 </section>:visibleEntries.map(v=>noticeCard(v))}</>}
 </>}
 {notice&&!compose&&<p role={['saved','copied'].includes(notice)?'status':'alert'}>{tx(notice)}</p>}<button className="button button--outline" disabled={busy} onClick={refresh}>{tx('refresh')}</button>
 </section>;
 function noticeCard(v:TeamEntry,embedded=false){
 const contents=<>

 <h3 className="team-message-thread-heading">{tx(v.kind)} · {tx(v.outgoing?'outgoing':v.read?'read':'unread')}</h3><p>{v.outgoing?tx('you'):person(v.sender)} · {new Date(v.createdAt).toLocaleString()}</p>
 <strong>{tx(v.state)}</strong>{v.outgoing&&<p>{tx('delivered')}: {v.recipientCount}</p>}
 {!v.outgoing&&!v.read&&!opened.includes(v.id)&&<button className="button button--outline" disabled={busy} onClick={()=>void run('read',{id:v.id})}>{t('workflow.notifications.markRead')}</button>}
 {
 v.kind==='absence'?<p>{String(v.payload.dateFrom)} - {String(v.payload.dateTo)}</p>:<p>{String(v.payload.localDate)} · {String(v.payload.startTime)}-{String(v.payload.endTime)} · Europe/Warsaw · {tx('planned')}</p>}
 {value?.role!=='agency_admin'&&v.outgoing&&v.state==='active'&&<div className="form-actions"><Link to={'/workspace/'+organizationId+'/'+(v.kind==='absence'?'absence':'schedule')}>{tx('section')}</Link>{section!=='messages'&&<button className="button button--outline" disabled={busy} onClick={()=>editPlan(v)}>{tx('edit')}</button>}<button className="button button--outline" disabled={busy} onClick={()=>{dirty();void run('cancel',{id:v.id,revision:v.revision})}}>{tx('cancelPlan')}</button></div>}
 </>;
 return embedded?contents:<article className="notice-box" key={v.id} id={'team-notice-'+v.id} tabIndex={-1}>{contents}</article>}
}
function WorkerSchedule({entries}:{entries:TeamEntry[]}){
 const {t,i18n}=useTranslation();
 const rows=workerScheduleRows(entries);
 const date=new Intl.DateTimeFormat(i18n.resolvedLanguage,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
 return <section className="dashboard-panel" aria-label={t('workflow.schedule.mySchedule')}>
  <p className="muted-copy">{t('workflow.schedule.plannedDisclaimer')}</p>
  {!rows.length?<p>{t('workflow.schedule.empty')}</p>:<ul className="factory-summary-list">{rows.map(row=><li className="factory-summary-row" key={row.id}>
   <time dateTime={row.day}>{date.format(new Date(row.day+'T12:00:00Z'))}</time><strong>{row.start}–{row.end}</strong>
   {row.cancelled&&<span className="status-pill">{t('workflow.schedule.state.cancelled')}</span>}
  </li>)}</ul>}
 </section>;
}
export function AccountantInvitePage(){
 const {t}=useTranslation(),tx=(k:string)=>t('team.'+k),location=useLocation();
 const [code,C]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('invite')??''),[busy,B]=useState(false),[notice,N]=useState(''),[org,O]=useState('');
 const op=useRef(crypto.randomUUID());
 useEffect(()=>{if(window.location.hash.startsWith('#invite='))window.history.replaceState(window.history.state,'',location.pathname)},[location.pathname]);
 return <RegistrationFrame title={tx('accountants')} lead={tx('acceptHint')}><p>{tx('noMail')}</p><Link to="/login">{t('common.login')}</Link>{org?<><p role="status">{tx('accepted')}</p><Link to={'/workspace/'+org+'/payslips'}>{t('canonicalPayslips.title')}</Link></>:<form className="auth-form" onSubmit={e=>{e.preventDefault();if(busy)return;B(true);void teamCall(undefined,'accept-accountant',{operationId:op.current,code}).then(v=>{if(v.state!=='accepted')throw Error('closed');O(v.organizationId);C('')}).catch(e=>N(e.message)).finally(()=>B(false))}}><label className="field-label">{tx('invitationCode')}<input required autoComplete="off" maxLength={64} value={code} onChange={e=>C(e.target.value)}/></label><button className="button button--primary" disabled={busy||!/^[a-f0-9]{64}$/.test(code)}>{tx('accept')}</button></form>}{notice&&<p role="alert">{tx(notice)}</p>}</RegistrationFrame>;
}
