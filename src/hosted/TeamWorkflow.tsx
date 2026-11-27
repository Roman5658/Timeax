import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Bell,Send} from 'lucide-react';
import {RegistrationFrame} from '../components/PublicExperience';
import {useMemberNames} from './MemberNames';
import {teamCall,useTeam,changed,type ShiftTemplate,type TeamEntry} from './team-workflow';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {cleanTeamDay,eligibleTeamRecipients,warsawTeamDay,type TeamAudience} from './team-communication';
import {indexMessageThreads} from './team-message-threads';
import {teamCommunicationCopy} from './team-communication-copy';
import {AgencySchedule} from './AgencySchedule';
import '../styles/team-workflow.css';
export type TeamSection='messages'|'schedule'|'templates'|'absence'|'accountants';
const workerHelp={
 en:{noSite:'To report an absence here, you need an assigned production site. You can message your agency in the meantime.',fill:'Fill in from a shift template'},
 ru:{noSite:'Прежде чем сообщить об отсутствии здесь, нужно быть назначенным на производство. Пока можно написать своему агентству.',fill:'Заполнить по шаблону смены'},
 pl:{noSite:'Aby zgłosić nieobecność tutaj, musisz mieć przypisane miejsce pracy. W międzyczasie możesz napisać do agencji.',fill:'Uzupełnij z szablonu zmiany'},
 uk:{noSite:'Щоб повідомити про відсутність тут, потрібно мати призначене виробництво. Поки можна написати своїй агенції.',fill:'Заповнити за шаблоном зміни'},
};
const localized=(language:string|undefined)=>workerHelp[(language??'en').split('-')[0] as keyof typeof workerHelp]??workerHelp.en;
export function TeamBell({organizationId,additionalUnread=0}:{organizationId:string;additionalUnread?:number}){
 const {t}=useTranslation(),{value}=useTeam(organizationId);
 const count=(value?.unread??0)+(Number.isSafeInteger(additionalUnread)&&additionalUnread>0?additionalUnread:0);
 return <Link className="button button--outline button--small team-bell" to={'/workspace/'+organizationId+'/messages'}
  aria-label={value||count?t('team.notifications',{count}):t('team.messages')}><Bell size={19} aria-hidden="true"/>
  {count>0&&<span aria-hidden="true">{count}</span>}</Link>;
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
export function TeamPanel({organizationId,section,initialDay,compact=false}:{organizationId:string;section:TeamSection;initialDay?:string;compact?:boolean}){
 const {t,i18n}=useTranslation(),tx=(k:string)=>t('team.'+k),{value,error,refresh}=useTeam(organizationId),{label}=useMemberNames(organizationId);
 const workerCopy=localized(i18n.resolvedLanguage),copy=teamCommunicationCopy(i18n.resolvedLanguage),route=useLocation();
 const absenceDay=section==='absence'?(cleanTeamDay(initialDay??null)||cleanTeamDay(new URLSearchParams(route.search).get('date'))):'';
 const [compose,Compose]=useState(false),[audience,SetAudience]=useState<TeamAudience>('workers'),[folder,Folder]=useState<'inbox'|'sent'|'unread'>('inbox');
 const [replyTo,ReplyTo]=useState<TeamEntry>(),[subject,Subject]=useState('');
 const [busy,B]=useState(false),[notice,N]=useState(''),[site,S]=useState(''),[selected,C]=useState<string[]>([]),[body,T]=useState(''),[opened,O]=useState<string[]>([]);
 const [date,D]=useState(()=>absenceDay||warsawTeamDay()),[until,U]=useState(date),[start,A]=useState('08:00'),[end,Z]=useState('16:00');
 const [edit,E]=useState<TeamEntry>(),[template,ET]=useState<ShiftTemplate>(),[name,NM]=useState(''),[minutes,M]=useState(0),[paid,P]=useState(false),[email,EM]=useState(''),[invite,I]=useState('');
 const sending=useRef(false);
 const op=useRef(crypto.randomUUID());const dirty=()=>{op.current=crypto.randomUUID();N('')};
 useEffect(()=>{E(undefined);ET(undefined);C([]);T('');O([]);I('');N('');S('');ReplyTo(undefined);Subject('');Compose(false);Folder('inbox');dirty()},[organizationId,section]);
 useEffect(()=>{if(section==='absence'){const next=absenceDay||warsawTeamDay();D(next);U(next);E(undefined);dirty()}},[section,organizationId,absenceDay]);
 async function run(action:string,data:Record<string,unknown>){if(sending.current)return;sending.current=true;B(true);N('');try{
  const r=await teamCall(organizationId,action,{...data,...(action==='read'?{}:{operationId:op.current})});
  if(action==='invite-accountant')I(location.origin+'/accountant/invitation#invite='+r.code);
  if(action==='read'){O(a=>[...a,String(data.id)]);if(folder==='unread')Folder('inbox');}
  if(action==='message'){Compose(false);ReplyTo(undefined);Subject('');C([]);Folder('sent');}
  else {T('');E(undefined);ET(undefined);NM('');N('saved');op.current=crypto.randomUUID()}
  changed();
 }catch(e){N((e as Error).message);refresh()}finally{sending.current=false;B(false)}}
 function editPlan(e:TeamEntry){E(e);S(e.siteId??'');C(e.recipients??[]);D(String(e.payload.localDate??e.payload.dateFrom));U(String(e.payload.dateTo??e.payload.localDate));A(String(e.payload.startTime??'08:00'));Z(String(e.payload.endTime??'16:00'));dirty()}
 const siteInput=(required=false)=><label className="field-label">{t('timecards.site')}<select value={site} required={required} disabled={busy||!!edit} onChange={e=>{S(e.target.value);if(section==='schedule')C([]);dirty()}}><option value="">{tx('choose')}</option>{value?.sites.filter(w=>section!=='schedule'||w.canPlan).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>;
 const person=(id:string)=>{const r=value?.recipients.find(x=>x.id===id);return r?.role==='worker'?label(id):r?t('workspaceRead.'+r.role)+' · '+r.organizationName:tx('sender')};
 const messageAudiences:TeamAudience[]=value?.role==='worker'?['agency','leader']:value?.role==='team_leader'?['workers','agency']:['workers','production','leader'];
 const capable=Boolean(value&&['worker','agency_admin','team_leader'].includes(value.role));
 const modeTitle=(mode:TeamAudience)=>t('workflow.messagesCenter.'+({agency:'toAgency',workers:'selectedWorkers',production:'allProduction',leader:'toLeader'}[mode]));
 const sites=value?.sites??[];
 const filteredRecipients=value?eligibleTeamRecipients(value,audience,site).filter(r=>!replyTo||r.id===replyTo.sender):[];
 const recipients=audience==='production'?filteredRecipients.map(r=>r.id):selected.filter(id=>filteredRecipients.some(r=>r.id===id));
 const draftHasSite=audience==='leader'||audience==='production'||value?.role==='team_leader';
 function setAudience(mode:TeamAudience){
  SetAudience(mode);C([]);S(mode==='agency'&&value?.role==='worker'||mode==='workers'&&value?.role==='agency_admin'?'':sites.length===1?sites[0].id:'');dirty();
 }
 function newMessage(){
  ReplyTo(undefined);Subject('');T('');Compose(true);setAudience(value?.role==='worker'?'agency':'workers');
 }
 function responseMode(entry:TeamEntry){
  const target=value?.recipients.find(r=>r.id===entry.sender);
  if(!target)return null;
  const mode:TeamAudience=target.role==='agency_admin'?'agency':target.role==='team_leader'?'leader':'workers';
  const requireSite=mode==='leader'||value?.role==='team_leader';
  const chosen=requireSite?(entry.siteId??(sites.length===1?sites[0].id:'')):'';
  return value&&eligibleTeamRecipients(value,mode,chosen).some(r=>r.id===target.id)?{target,mode,chosen}:null;
 }
 function reply(entry:TeamEntry){
  const next=responseMode(entry);
  if(!next)return;
  ReplyTo(entry);Compose(true);SetAudience(next.mode);S(next.chosen);C([next.target.id]);T('');Subject(typeof entry.payload.subject==='string'?entry.payload.subject:'');dirty();
 }
 const threads=useMemo(()=>indexMessageThreads(value?.messageThreads&&section==='messages'?value.entries:[]),[value,section]);
 const visibleEntries=value?.entries.filter(v=>section==='messages'
  ?folder==='sent'?v.outgoing:!v.outgoing&&(folder==='inbox'||!v.read)
  :v.kind===(section==='schedule'?'schedule':'absence'))??[];
 const choices=(workersOnly=false)=><fieldset disabled={busy||!!edit}><legend>{tx('recipients')}</legend><div className="team-recipients">{value?.recipients.filter(x=>!workersOnly||x.role==='worker'&&x.worksiteIds.includes(site)).map(r=><label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e=>{C(a=>e.target.checked?[...a,r.id]:a.filter(x=>x!==r.id));dirty()}}/>{person(r.id)}</label>)}</div><small>{tx('recipientScope')}</small></fieldset>;
 const dates=<div className="timecards-pair"><label className="field-label">{tx('from')}<input type="date" required value={date} onChange={e=>{D(e.target.value);if(e.target.value>until)U(e.target.value);dirty()}}/></label><label className="field-label">{tx('to')}<input type="date" required min={date} value={until} onChange={e=>{U(e.target.value);dirty()}}/></label></div>;
 const times=<div className="timecards-pair"><label className="field-label">{t('timecards.start')}<input type="time" required value={start} onChange={e=>{A(e.target.value);dirty()}}/></label><label className="field-label">{t('timecards.end')}<input type="time" required value={end} onChange={e=>{Z(e.target.value);dirty()}}/></label></div>;
 return <section className="worker-enrollment team-panel" aria-busy={busy}>
 {!value?<p role="status">{tx(error||'closed')}</p>:<>
 {section==='messages'&&<>
 <p>{tx('messageHint')}</p>
 <div className="form-actions team-message-tools">
 {capable&&<button className="button button--primary" type="button" onClick={newMessage}><Send size={16} aria-hidden="true"/>{copy.open}</button>}
 {value.role==='worker'&&<Link className="button button--outline" to={'/workspace/'+organizationId+'/absence'}>{tx('absence')}</Link>}
 </div>
 <div className="form-actions team-message-folders" role="group" aria-label={copy.filters}>
 {(['inbox','sent','unread'] as const).map(v=><button className={'button button--small '+(folder===v?'button--primary':'button--outline')} key={v} type="button" disabled={busy}
  aria-pressed={folder===v} onClick={()=>Folder(v)}>{copy[v]}{v==='unread'&&value.unread>0?' ('+value.unread+')':''}</button>)}
 </div>
 {compose&&capable&&<AgencyBookDrawer title={replyTo?copy.replying.replace('{{name}}',person(replyTo.sender)):copy.compose} closeLabel={t('common.close')} busy={busy} onClose={()=>{Compose(false);ReplyTo(undefined);N('')}}>
  <form className="auth-form team-message-compose" onSubmit={e=>{
   e.preventDefault();if(!recipients.length||recipients.length>100||!body.trim())return;
   void run('message',{siteId:value.messageThreads&&replyTo?replyTo.siteId:draftHasSite?site:null,recipients,payload:{
    text:body.trim(),...(value.messageThreads&&subject.trim()?{subject:subject.trim()}:{}),...(value.messageThreads&&replyTo?{replyTo:replyTo.id}:{})
   }});
  }}>
   {!replyTo&&<label className="field-label">{copy.fields}<select value={audience} disabled={busy} onChange={e=>setAudience(e.target.value as TeamAudience)}>
    {messageAudiences.filter(m=>m!=='leader'||value.recipients.some(r=>r.role==='team_leader'&&(r.worksiteIds.length||sites.length===1))).map(m=><option key={m} value={m}>{modeTitle(m)}</option>)}
   </select></label>}
   {draftHasSite&&!replyTo&&<label className="field-label">{t('timecards.site')}<select required value={site} disabled={busy} onChange={e=>{S(e.target.value);C([]);dirty()}}>
    <option value="">{tx('choose')}</option>{sites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
   </select></label>}
   {filteredRecipients.length===0?<p className="notice-box">{t('workflow.messagesCenter.noRecipients')}</p>:
    <fieldset disabled={busy||!!replyTo}><legend>{copy.defaultSend}</legend>
     {audience==='workers'&&!replyTo&&<div className="form-actions"><button className="button button--outline button--small" type="button" disabled={filteredRecipients.length>100}
       onClick={()=>{C(filteredRecipients.map(r=>r.id));dirty()}}>{copy.all}</button><button className="button button--outline button--small" type="button"
       onClick={()=>{C([]);dirty()}}>{copy.none}</button></div>}
     <div className="team-recipients">{filteredRecipients.map(r=>audience==='production'?<p key={r.id}>{person(r.id)}</p>:<label key={r.id}>
       <input type={audience==='workers'?'checkbox':'radio'} name={'recipient-'+organizationId} disabled={!recipients.includes(r.id)&&recipients.length>=100}
        checked={recipients.includes(r.id)} onChange={e=>{C(a=>audience==='workers'?(e.target.checked?[...a,r.id]:a.filter(x=>x!==r.id)):[r.id]);dirty()}}/>{person(r.id)}</label>)}</div>
     <small>{recipients.length>100?copy.tooMany:copy.selection.replace('{{count}}',String(recipients.length))}</small>
    </fieldset>}
   {value.messageThreads&&<label className="field-label">{t('workflow.messagesCenter.subject')}<input maxLength={120} value={subject} disabled={busy} onChange={e=>{Subject(e.target.value);dirty()}}/></label>}
   <label className="field-label">{tx('message')}<textarea required maxLength={2000} rows={4} value={body} disabled={busy} onChange={e=>{T(e.target.value);dirty()}}/></label>
   <small>{tx('noSensitive')}</small><button type="submit" className="button button--primary" disabled={busy||!recipients.length||recipients.length>100||!body.trim()}>{tx('send')}</button>
   {notice&&<p role="alert">{tx(notice)}</p>}
  </form>
 </AgencyBookDrawer>}
 </>}
 {section==='absence'&&value.role==='worker'&&!value.sites.length&&<p className="notice-box">{workerCopy.noSite} <Link to={'/workspace/'+organizationId+'/messages'}>{tx('messages')}</Link></p>}
 {section==='absence'&&value.role==='worker'&&!!value.sites.length&&<form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run(edit?'update-plan':'absence',{...(edit?{id:edit.id,revision:edit.revision}:{siteId:site}),payload:{dateFrom:date,dateTo:until}})}}>
 {!compact&&<h2>{tx('absence')}</h2>}<p>{tx('absenceHint')}</p>{siteInput(true)}{dates}<button className="button button--primary" disabled={busy||!site}>{tx(edit?'save':'send')}</button></form>}
 {section==='schedule'&&value.role==='agency_admin'&&<AgencySchedule key={organizationId} context={value} workerLabel={label}/>}
 {section==='schedule'&&value.role!=='agency_admin'&&<><p className="notice-box">{tx('plannedOnly')}</p>{value.role==='team_leader'&&<form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run(edit?'update-plan':'schedule',{...(edit?{id:edit.id,revision:edit.revision}:{siteId:site,recipients:selected}),payload:{localDate:date,startTime:start,endTime:end}})}}>
 {siteInput(true)}{choices(true)}<label className="field-label">{t('timecards.date')}<input type="date" required value={date} onChange={e=>{D(e.target.value);dirty()}}/></label>{times}<p>{t('timecards.overnight')} · Europe/Warsaw</p><button className="button button--primary" disabled={busy||!site||!selected.length}>{tx(edit?'save':'plan')}</button></form>}</>}
 {section==='templates'&&value.role==='worker'&&<><form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run('save-template',{id:template?.id??null,revision:template?.revision??null,name,data:{startTime:start,endTime:end,breakMinutes:minutes,breakTreatment:paid?'paid':'unpaid'}})}}>
 <h2>{tx(template?'editTemplate':'newTemplate')}</h2><label className="field-label">{tx('name')}<input required maxLength={80} value={name} onChange={e=>{NM(e.target.value);dirty()}}/></label>{times}<label className="field-label">{t('timecards.break')}<input type="number" min="0" max="720" value={minutes} onChange={e=>{M(Number(e.target.value));dirty()}}/></label><label><input type="checkbox" checked={paid} onChange={e=>{P(e.target.checked);dirty()}}/>{t('timecards.paidBreak')}</label><button className="button button--primary" disabled={busy}>{tx('save')}</button></form>
 {value.templates.map(v=><article className="notice-box" key={v.id}><h3>{v.name}</h3><p>{v.data.startTime}–{v.data.endTime} · {v.data.breakMinutes} {t('workerAccount.minutes')}</p><button className="button button--outline" disabled={busy} onClick={()=>{ET(v);NM(v.name);A(v.data.startTime);Z(v.data.endTime);M(v.data.breakMinutes);P(v.data.breakTreatment==='paid');dirty()}}>{tx('edit')}</button> <button className="button button--outline" disabled={busy} onClick={()=>{if(window.confirm(tx('deleteConfirm'))){dirty();void run('delete-template',{id:v.id,revision:v.revision})}}}>{tx('delete')}</button></article>)}<Link to={'/workspace/'+organizationId+'/timecards'}>{tx('useTemplate')}</Link></>}
 {section==='accountants'&&value.role==='agency_admin'&&<><p>{tx('accountantHint')}</p><form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run('invite-accountant',{email})}}><label className="field-label">{tx('email')}<input type="email" required maxLength={254} value={email} onChange={e=>{EM(e.target.value);I('');dirty()}}/></label><button className="button button--primary" disabled={busy}>{tx('invite')}</button></form>
 {invite&&<div className="notice-box"><label className="field-label">{tx('inviteLink')}<input readOnly value={invite} onFocus={e=>e.target.select()}/></label><p>{tx('noMail')}</p><button className="button button--outline" onClick={()=>{void navigator.clipboard.writeText(invite).then(()=>N('copied')).catch(()=>N('copyManually'))}}>{tx('copy')}</button></div>}
 {value.invitations.map(v=><article className="notice-box" key={v.id}><strong>{v.email}</strong><p>{tx(v.state)} · {new Date(v.expiresAt).toLocaleString()}</p>{!['revoked','expired'].includes(v.state)&&<button className="button button--outline" disabled={busy} onClick={()=>{if(window.confirm(tx('revokeConfirm'))){dirty();void run('revoke-accountant',{id:v.id})}}}>{tx('revoke')}</button>}</article>)}</>}
 {edit&&<button className="button button--outline" onClick={()=>{E(undefined);dirty()}}>{tx('stopEditing')}</button>}
 {['messages','schedule','absence'].includes(section)&&!(section==='schedule'&&value.role==='agency_admin')&&<>{!compact&&<h2>{tx('history')}</h2>}
 {section==='messages'&&!visibleEntries.length&&<p className="muted-copy">{copy.empty}</p>}
 {visibleEntries.map(v=><article className="notice-box" key={v.id}>
 <h3 className="team-message-thread-heading">{v.kind==='message'&&typeof v.payload.subject==='string'?v.payload.subject:tx(v.kind)} · {tx(v.outgoing?'outgoing':v.read?'read':'unread')}</h3><p>{v.outgoing?tx('you'):person(v.sender)} · {new Date(v.createdAt).toLocaleString()}</p>
 <strong>{tx(v.state)}</strong>{v.outgoing&&<p>{tx('delivered')}: {v.recipientCount}</p>}
 {!v.outgoing&&!v.read&&!opened.includes(v.id)?<button className="button button--outline" disabled={busy} onClick={()=>void run('read',{id:v.id})}>{tx('open')}</button>:<>
 {v.kind==='message'?<p className="team-body">{String(v.payload.text)}</p>:v.kind==='absence'?<p>{String(v.payload.dateFrom)} — {String(v.payload.dateTo)}</p>:<p>{String(v.payload.localDate)} · {String(v.payload.startTime)}–{String(v.payload.endTime)} · Europe/Warsaw · {tx('planned')}</p>}
 {value.messageThreads&&section==='messages'&&v.kind==='message'&&threads(v).some(x=>x.id!==v.id&&(x.outgoing||x.read))&&
  <details><summary>{t('workflow.messagesCenter.title')}</summary>
   {threads(v).filter(x=>x.id!==v.id&&(x.outgoing||x.read)).slice(0,30).map(x=><blockquote className="team-body" key={x.id}>
    <strong>{x.outgoing?tx('you'):person(x.sender)}</strong><p>{String(x.payload.text)}</p>
   </blockquote>)}
  </details>}
 {!v.outgoing&&v.kind==='message'&&section==='messages'&&responseMode(v)&&<button className="button button--outline" onClick={()=>reply(v)}>{tx('reply')}</button>}</>}
 {value.role!=='agency_admin'&&v.outgoing&&v.kind!=='message'&&v.state==='active'&&<div className="form-actions"><Link to={'/workspace/'+organizationId+'/'+(v.kind==='absence'?'absence':'schedule')}>{tx('section')}</Link>{section!=='messages'&&<button className="button button--outline" disabled={busy} onClick={()=>editPlan(v)}>{tx('edit')}</button>}<button className="button button--outline" disabled={busy} onClick={()=>{dirty();void run('cancel',{id:v.id,revision:v.revision})}}>{tx('cancelPlan')}</button></div>}
 </article>)}</>}
 </>}
 {notice&&!compose&&<p role={['saved','copied'].includes(notice)?'status':'alert'}>{tx(notice)}</p>}<button className="button button--outline" disabled={busy} onClick={refresh}>{tx('refresh')}</button>
 </section>;
}
export function AccountantInvitePage(){
 const {t}=useTranslation(),tx=(k:string)=>t('team.'+k),location=useLocation();
 const [code,C]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('invite')??''),[busy,B]=useState(false),[notice,N]=useState(''),[org,O]=useState('');
 const op=useRef(crypto.randomUUID());
 useEffect(()=>{if(window.location.hash.startsWith('#invite='))window.history.replaceState(window.history.state,'',location.pathname)},[location.pathname]);
 return <RegistrationFrame title={tx('accountants')} lead={tx('acceptHint')}><p>{tx('noMail')}</p><Link to="/login">{t('common.login')}</Link>{org?<><p role="status">{tx('accepted')}</p><Link to={'/workspace/'+org+'/payslips'}>{t('canonicalPayslips.title')}</Link></>:<form className="auth-form" onSubmit={e=>{e.preventDefault();if(busy)return;B(true);void teamCall(undefined,'accept-accountant',{operationId:op.current,code}).then(v=>{if(v.state!=='accepted')throw Error('closed');O(v.organizationId);C('')}).catch(e=>N(e.message)).finally(()=>B(false))}}><label className="field-label">{tx('invitationCode')}<input required autoComplete="off" maxLength={64} value={code} onChange={e=>C(e.target.value)}/></label><button className="button button--primary" disabled={busy||!/^[a-f0-9]{64}$/.test(code)}>{tx('accept')}</button></form>}{notice&&<p role="alert">{tx(notice)}</p>}</RegistrationFrame>;
}
