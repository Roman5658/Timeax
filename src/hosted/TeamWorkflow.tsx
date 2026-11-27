import {useEffect,useRef,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Bell} from 'lucide-react';
import {RegistrationFrame} from '../components/PublicExperience';
import {useMemberNames} from './MemberNames';
import {teamCall,useTeam,changed,type ShiftTemplate,type TeamEntry} from './team-workflow';
import {AgencySchedule} from './AgencySchedule';
import '../styles/team-workflow.css';
export type TeamSection='messages'|'schedule'|'templates'|'absence'|'accountants';
export function TeamBell({organizationId}:{organizationId:string}){
 const {t}=useTranslation(),{value}=useTeam(organizationId);
 return value?<Link className="button button--outline button--small team-bell" to={'/workspace/'+organizationId+'/messages'} aria-label={t('team.notifications',{count:value.unread})}><Bell size={19}/><span aria-live="polite">{value.unread}</span></Link>:null;
}
export function TemplatePicker({organizationId,onApply,disabled}:{organizationId:string;onApply:(v:ShiftTemplate['data'])=>void;disabled:boolean}){
 const {t}=useTranslation(),{value}=useTeam(organizationId);
 return <div className="form-actions"><label className="field-label">{t('team.template')}<select value="" disabled={disabled||!value?.templates.length} onChange={e=>{const v=value?.templates.find(x=>x.id===e.target.value);if(v)onApply(v.data)}}><option value="">{t('team.chooseTemplate')}</option>{value?.templates.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><Link to={'/workspace/'+organizationId+'/templates'}>{t('team.templates')}</Link></div>;
}
export function TeamStandalone({organizationId,section}:{organizationId:string;section:TeamSection}){
 const {t}=useTranslation();return <RegistrationFrame title={t('team.'+section)} lead={t('team.scope')}><TeamBell organizationId={organizationId}/><TeamPanel organizationId={organizationId} section={section}/><Link to={'/workspace/'+organizationId}>{t('team.back')}</Link></RegistrationFrame>;
}
export function TeamPanel({organizationId,section}:{organizationId:string;section:TeamSection}){
 const {t}=useTranslation(),tx=(k:string)=>t('team.'+k),{value,error,refresh}=useTeam(organizationId),{label}=useMemberNames(organizationId);
 const [busy,B]=useState(false),[notice,N]=useState(''),[site,S]=useState(''),[selected,C]=useState<string[]>([]),[body,T]=useState(''),[opened,O]=useState<string[]>([]);
 const [date,D]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw'}).format(new Date())),[until,U]=useState(date),[start,A]=useState('08:00'),[end,Z]=useState('16:00');
 const [edit,E]=useState<TeamEntry>(),[template,ET]=useState<ShiftTemplate>(),[name,NM]=useState(''),[minutes,M]=useState(0),[paid,P]=useState(false),[email,EM]=useState(''),[invite,I]=useState('');
 const op=useRef(crypto.randomUUID());const dirty=()=>{op.current=crypto.randomUUID();N('')};
 useEffect(()=>{E(undefined);ET(undefined);C([]);T('');O([]);I('');N('');dirty()},[organizationId,section]);
 async function run(action:string,data:Record<string,unknown>){if(busy)return;B(true);N('');try{
  const r=await teamCall(organizationId,action,{...data,...(action==='read'?{}:{operationId:op.current})});
  if(action==='invite-accountant')I(location.origin+'/accountant/invitation#invite='+r.code);
  if(action==='read')O(a=>[...a,String(data.id)]);
  else {T('');E(undefined);ET(undefined);NM('');N('saved');op.current=crypto.randomUUID()}
  changed();refresh();
 }catch(e){N((e as Error).message);refresh()}finally{B(false)}}
 function editPlan(e:TeamEntry){E(e);S(e.siteId??'');C(e.recipients??[]);D(String(e.payload.localDate??e.payload.dateFrom));U(String(e.payload.dateTo??e.payload.localDate));A(String(e.payload.startTime??'08:00'));Z(String(e.payload.endTime??'16:00'));dirty()}
 const siteInput=(required=false)=><label className="field-label">{t('timecards.site')}<select value={site} required={required} disabled={busy||!!edit} onChange={e=>{S(e.target.value);if(section==='schedule')C([]);dirty()}}><option value="">{tx('choose')}</option>{value?.sites.filter(w=>section!=='schedule'||w.canPlan).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>;
 const person=(id:string)=>{const r=value?.recipients.find(x=>x.id===id);return r?.role==='worker'?label(id):r?t('workspaceRead.'+r.role)+' · '+r.organizationName:tx('sender')};
 const choices=(workersOnly=false)=><fieldset disabled={busy||!!edit}><legend>{tx('recipients')}</legend><div className="team-recipients">{value?.recipients.filter(x=>!workersOnly||x.role==='worker'&&x.worksiteIds.includes(site)).map(r=><label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e=>{C(a=>e.target.checked?[...a,r.id]:a.filter(x=>x!==r.id));dirty()}}/>{person(r.id)}</label>)}</div><small>{tx('recipientScope')}</small></fieldset>;
 const dates=<div className="timecards-pair"><label className="field-label">{tx('from')}<input type="date" required value={date} onChange={e=>{D(e.target.value);dirty()}}/></label><label className="field-label">{tx('to')}<input type="date" required min={date} value={until} onChange={e=>{U(e.target.value);dirty()}}/></label></div>;
 const times=<div className="timecards-pair"><label className="field-label">{t('timecards.start')}<input type="time" required value={start} onChange={e=>{A(e.target.value);dirty()}}/></label><label className="field-label">{t('timecards.end')}<input type="time" required value={end} onChange={e=>{Z(e.target.value);dirty()}}/></label></div>;
 return <section className="worker-enrollment team-panel" aria-busy={busy}>
 {!value?<p role="status">{tx(error||'closed')}</p>:<>
 {section==='messages'&&<>
 <p>{tx('messageHint')}</p>{value.role==='worker'&&<Link className="button button--outline" to={'/workspace/'+organizationId+'/absence'}>{tx('absence')}</Link>}
 {['worker','agency_admin','team_leader'].includes(value.role)&&<form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run('message',{siteId:site||null,recipients:selected,payload:{text:body}})}}>
 {siteInput()}{choices()}<label className="field-label">{tx('message')}<textarea required maxLength={2000} rows={4} value={body} onChange={e=>{T(e.target.value);dirty()}}/></label><small>{tx('noSensitive')}</small><button className="button button--primary" disabled={busy||!selected.length||!body.trim()}>{tx('send')}</button></form>}
 </>}
 {section==='absence'&&value.role==='worker'&&<form className="auth-form dashboard-panel" onSubmit={e=>{e.preventDefault();void run(edit?'update-plan':'absence',{...(edit?{id:edit.id,revision:edit.revision}:{siteId:site}),payload:{dateFrom:date,dateTo:until}})}}>
 <h2>{tx('absence')}</h2><p>{tx('absenceHint')}</p>{siteInput(true)}{dates}<button className="button button--primary" disabled={busy||!site}>{tx(edit?'save':'send')}</button></form>}
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
 {['messages','schedule','absence'].includes(section)&&!(section==='schedule'&&value.role==='agency_admin')&&<><h2>{tx('history')}</h2>
 {value.entries.filter(v=>section==='messages'||v.kind===(section==='schedule'?'schedule':'absence')).map(v=><article className="notice-box" key={v.id}>
 <h3>{tx(v.kind)} · {tx(v.outgoing?'outgoing':v.read?'read':'unread')}</h3><p>{v.outgoing?tx('you'):person(v.sender)} · {new Date(v.createdAt).toLocaleString()}</p>
 <strong>{tx(v.state)}</strong>{v.outgoing&&<p>{tx('delivered')}: {v.recipientCount}</p>}
 {!v.outgoing&&!opened.includes(v.id)?<button className="button button--outline" disabled={busy} onClick={()=>void run('read',{id:v.id})}>{tx('open')}</button>:<>
 {v.kind==='message'?<p className="team-body">{String(v.payload.text)}</p>:v.kind==='absence'?<p>{String(v.payload.dateFrom)} — {String(v.payload.dateTo)}</p>:<p>{String(v.payload.localDate)} · {String(v.payload.startTime)}–{String(v.payload.endTime)} · Europe/Warsaw · {tx('planned')}</p>}
 {!v.outgoing&&v.kind==='message'&&<button className="button button--outline" onClick={()=>{C([v.sender]);S(v.siteId??'');T('');dirty()}}>{tx('reply')}</button>}</>}
 {value.role!=='agency_admin'&&v.outgoing&&v.kind!=='message'&&v.state==='active'&&<div className="form-actions"><Link to={'/workspace/'+organizationId+'/'+(v.kind==='absence'?'absence':'schedule')}>{tx('section')}</Link>{section!=='messages'&&<button className="button button--outline" disabled={busy} onClick={()=>editPlan(v)}>{tx('edit')}</button>}<button className="button button--outline" disabled={busy} onClick={()=>{dirty();void run('cancel',{id:v.id,revision:v.revision})}}>{tx('cancelPlan')}</button></div>}
 </article>)}</>}
 </>}
 {notice&&<p role={['saved','copied'].includes(notice)?'status':'alert'}>{tx(notice)}</p>}<button className="button button--outline" disabled={busy} onClick={refresh}>{tx('refresh')}</button>
 </section>;
}
export function AccountantInvitePage(){
 const {t}=useTranslation(),tx=(k:string)=>t('team.'+k),location=useLocation();
 const [code,C]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('invite')??''),[busy,B]=useState(false),[notice,N]=useState(''),[org,O]=useState('');
 const op=useRef(crypto.randomUUID());
 useEffect(()=>{if(window.location.hash.startsWith('#invite='))window.history.replaceState(window.history.state,'',location.pathname)},[location.pathname]);
 return <RegistrationFrame title={tx('accountants')} lead={tx('acceptHint')}><p>{tx('noMail')}</p><Link to="/login">{t('common.login')}</Link>{org?<><p role="status">{tx('accepted')}</p><Link to={'/workspace/'+org+'/payslips'}>{t('canonicalPayslips.title')}</Link></>:<form className="auth-form" onSubmit={e=>{e.preventDefault();if(busy)return;B(true);void teamCall(undefined,'accept-accountant',{operationId:op.current,code}).then(v=>{if(v.state!=='accepted')throw Error('closed');O(v.organizationId);C('')}).catch(e=>N(e.message)).finally(()=>B(false))}}><label className="field-label">{tx('invitationCode')}<input required autoComplete="off" maxLength={64} value={code} onChange={e=>C(e.target.value)}/></label><button className="button button--primary" disabled={busy||!/^[a-f0-9]{64}$/.test(code)}>{tx('accept')}</button></form>}{notice&&<p role="alert">{tx(notice)}</p>}</RegistrationFrame>;
}
