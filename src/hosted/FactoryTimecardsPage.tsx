import {workerShiftCopy} from './worker-shift-copy';
import {useMemberNames} from './MemberNames';
import {workerLabelText} from './member-label';
import {useEffect,useMemo,useRef,useState} from 'react';import {Link,useLocation} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';import {PrivateAccess} from './PrivateAccess';import {isWorkerLocal} from './worker-enrollment';import {minutesLabel} from './timecards';
import {factoryHoursCall,parseFactoryHours,parseFactorySnapshot,factorySnapshotCsv,type FactoryHoursContext,type FactoryShift,type FactorySnapshot} from './factory-timecards';
import '../styles/timecards.css';import '../styles/worker-enrollment.css';
const yesterday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
export function FactoryTimecardsPanel({organizationId,revision=0,archiveOnly=false,placementOnly=false,placementSiteId,readOnlyWorker=false,expectedRole,expectedMembershipId,leaderSection}:{organizationId:string;revision?:number;archiveOnly?:boolean;placementOnly?:boolean;placementSiteId?:string;readOnlyWorker?:boolean;allowWorkerCreate?:boolean;expectedRole?:FactoryHoursContext['role'];expectedMembershipId?:string;leaderSection?:'hours'|'timesheets'}){
 const {t,i18n}=useTranslation(),tx=(k:string)=>t('factoryHours.'+k),tt=(k:string)=>t('timecards.'+k);
 const [context,setContext]=useState<FactoryHoursContext>(),[status,setStatus]=useState('checking'),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const {label,organizationLabel}=useMemberNames(organizationId,revision+refresh);
 const [site,setSite]=useState(placementSiteId??''),[worker,setWorker]=useState(''),[agency,setAgency]=useState(''),[mode,setMode]=useState<'self'|'attendance'>('self'),[date,setDate]=useState(yesterday),[start,setStart]=useState('08:00'),[end,setEnd]=useState('16:00'),[pause,setPause]=useState(0),[paid,setPaid]=useState(false),[comment,setComment]=useState(''),[note,setNote]=useState(''),[editing,setEditing]=useState<FactoryShift>(),[from,setFrom]=useState(yesterday),[to,setTo]=useState(yesterday),[confirmed,setConfirmed]=useState(false),[assignmentStart,setAssignmentStart]=useState(new Date().toISOString().slice(0,10)),[snapshot,setSnapshot]=useState<FactorySnapshot>(),[history,setHistory]=useState<{action:string;note:string;after:FactoryShift}[]>();
 const op=useRef(crypto.randomUUID()),pending=useRef(false),dirty=()=>{op.current=crypto.randomUUID();setNotice('')};
 useEffect(()=>{const c=new AbortController();setContext(undefined);setStatus('checking');void factoryHoursCall(organizationId,'context',undefined,c.signal).then(v=>parseFactoryHours(v,organizationId)).then(v=>{if(expectedRole&&v.role!==expectedRole||expectedMembershipId&&v.membershipId!==expectedMembershipId)throw Error('denied');if(!c.signal.aborted){setContext(v);setStatus('ready')}}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>c.abort()},[organizationId,revision,refresh,expectedRole,expectedMembershipId]);
 useEffect(()=>{setSnapshot(undefined);setHistory(undefined);setEditing(undefined)},[organizationId,revision]);
 const activeSite=placementOnly?placementSiteId??'':site,chosen=context?.sites.find(s=>s.id===activeSite),leader=context?.role==='team_leader',factoryAdmin=context?.role==='factory_admin',own=context?.role==='worker';
 const [month,setMonth]=useState(()=>yesterday().slice(0,7)),[workerFilter,setWorkerFilter]=useState('');
 const administrationRows=context?.shifts.filter(s=>(!site||s.worksite_id===site)&&(!month||s.data.localDate.startsWith(month+'-')))??[];
 useEffect(()=>{if(chosen)setMode(chosen.mode??'self')},[chosen?.id,chosen?.mode,chosen?.modeRevision]);
 const rows=context?.assignments.filter(a=>a.worksiteId===site)??[];
 const canWrite=leader&&(editing?editing.source==='attendance':chosen?.mode==='attendance');
 const blob=useMemo(()=>snapshot?URL.createObjectURL(new Blob([factorySnapshotCsv(snapshot,factoryAdmin?'sent':'received')],{type:'text/csv;charset=utf-8'})):undefined,[snapshot,factoryAdmin]);useEffect(()=>()=>{if(blob)URL.revokeObjectURL(blob)},[blob]);
 async function act(action:string,body?:Record<string,unknown>){if(pending.current)return;pending.current=true;setBusy(true);setNotice('');try{
 const value=await factoryHoursCall(organizationId,action,body?{...body,...(!['history','create','correct'].includes(action)?{operationId:crypto.randomUUID()}:{})}:undefined);
 if(action==='create'||action==='correct')window.dispatchEvent(new Event('timeax-timecards-changed'));
 if(action.startsWith('read/')){
  const opened=parseFactorySnapshot((value as {snapshot:unknown}).snapshot);
  if(factoryAdmin){
   const metadata=context?.archive.find(a=>a.id===action.slice(5));
   if(!metadata||opened.factoryId!==organizationId||opened.worksiteId!==metadata.worksiteId||
    opened.organizationId!==metadata.agencyId||opened.dateFrom!==metadata.dateFrom||opened.dateTo!==metadata.dateTo)throw Error('denied');
  }
  setSnapshot(opened);
 }
 else if(action==='history'){const v=value as {events:typeof history};if(!Array.isArray(v.events))throw Error();setHistory(v.events)}
 else{setNotice('saved');setEditing(undefined);setNote('');op.current=crypto.randomUUID();setConfirmed(false);setRefresh(n=>n+1)}
 }catch(e){setNotice((e as Error).message||'uncertain');setRefresh(n=>n+1)}finally{pending.current=false;setBusy(false)}}
 const chooseSite=<label className="field-label">{tt('site')}<select value={site} disabled={busy||!!editing} onChange={e=>{setSite(e.target.value);setWorker('');setWorkerFilter('');setAgency('');setSnapshot(undefined);setConfirmed(false);dirty()}}><option value="">{tt('choose')}</option>{context?.sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>;
 function edit(s:FactoryShift){setEditing(s);setSite(s.worksite_id);setWorker(s.membership_id);setDate(s.data.localDate);setStart(s.data.startTime);setEnd(s.data.endTime);setPause(s.data.breakMinutes);setPaid(s.data.breakTreatment==='paid');setComment(s.data.comment);setNote('');dirty()}
 if(placementOnly)return <section className="worker-enrollment timecards" aria-busy={busy}>
  <h3>{tx('placement')}</h3>
  {!context?<p role="status">{tt(status)}</p>:context.role!=='agency_admin'?<p role="status">{tt('denied')}</p>:!chosen?<p role="status">{tt('noAssignment')}</p>:<>
   <form className="auth-form" onSubmit={e=>{e.preventDefault();if(!worker||!assignmentStart)return;void act('propose-placement',{worksiteId:activeSite,membershipId:worker,startsAt:assignmentStart+'T00:00:00.000Z'})}}>
    <label className="field-label">{tt('workerRef')}<select required value={worker} disabled={busy} onChange={e=>setWorker(e.target.value)}><option value="">{tt('choose')}</option>{context.workers.filter(w=>w.agencyId===organizationId).map(w=><option key={w.membershipId} value={w.membershipId}>{label(w.membershipId)}</option>)}</select></label>
    <label className="field-label">{tx('starts')}<input type="date" required value={assignmentStart} disabled={busy} onChange={e=>setAssignmentStart(e.target.value)}/></label>
    <button className="button button--primary" disabled={busy||!worker||!assignmentStart}>{tx('propose')}</button>
   </form>
   {context.placements.filter(p=>p.worksiteId===activeSite&&p.agencyId===organizationId).map(p=><article className="notice-box timecards-row" key={p.id}>
    <strong>{label(p.membershipId)}</strong><p>{tx(p.state)} · {new Date(p.startsAt).toLocaleDateString()}</p>
    {p.state!=='revoked'&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>void act('revoke-placement',{worksiteId:activeSite,id:p.id})}>{tx('revoke')}</button>}
   </article>)}
  </>}
  {notice&&<p role={notice==='saved'?'status':'alert'}>{notice==='saved'?tx('saved'):tt(['login','denied','invalid','conflict','period-closed'].includes(notice)?notice:'uncertain')}</p>}
  <button type="button" className="button button--outline" disabled={busy||status==='checking'} onClick={()=>setRefresh(n=>n+1)}>{tt('refresh')}</button>
 </section>;
 return <section className="worker-enrollment timecards" aria-busy={busy}><h2>{leaderSection==='timesheets'?t('workflow.factory.sections.timesheets'):tx(archiveOnly?'received':'title')}</h2>
 {!context?<p role="status">{tt(status)}</p>:factoryAdmin&&context.factoryAdminRead!==true?<p role="status">{tt('unavailable')}</p>:<>
 {(!archiveOnly||factoryAdmin||leader&&leaderSection==='timesheets')&&<>{own?<p><Link to={'/workspace/'+organizationId}>{workerShiftCopy(i18n.language).back}</Link></p>:chooseSite}</>}
 {!archiveOnly&&leaderSection!=='timesheets'&&<>
 {!own&&chosen&&<p>{tx('mode')}: <strong>{tx(chosen.mode??'unset')}</strong></p>}
 {leader&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('set-mode',{worksiteId:site,mode,revision:chosen?.modeRevision})}}>
 <label className="field-label">{tx('mode')}<select value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'self'|'attendance')}><option value="self">{tx('self')}</option><option value="attendance">{tx('attendance')}</option></select></label><p>{tx('modeHint')}</p><button className="button button--outline button--full" disabled={busy||!site}>{tx('saveMode')}</button></form>}
 {context.role==='agency_admin'&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('propose-placement',{worksiteId:site,membershipId:worker,startsAt:assignmentStart+'T00:00:00.000Z'})}}>
 <h3>{tx('placement')}</h3><label className="field-label">{tt('workerRef')}<select value={worker} disabled={busy} onChange={e=>setWorker(e.target.value)}><option value="">{tt('choose')}</option>{context.workers.map(w=><option key={w.membershipId} value={w.membershipId}>{label(w.membershipId)}</option>)}</select></label><label className="field-label">{tx('starts')}<input type="date" required value={assignmentStart} disabled={busy} onInput={e=>setAssignmentStart(e.currentTarget.value)} onChange={e=>setAssignmentStart(e.target.value)}/></label><button className="button button--outline button--full" disabled={busy||!site||!worker}>{tx('propose')}</button></form>}
 {!own&&!factoryAdmin&&context.placements.map(p=><article className="notice-box" key={p.id}><p>{context.sites.find(s=>s.id===p.worksiteId)?.name??p.worksiteId}</p><p>{organizationLabel(p.membershipId)} / {label(p.membershipId)}</p><p>{tx(p.state)} · {new Date(p.startsAt).toLocaleDateString()}</p>{context.role==='factory_admin'&&p.state==='pending'&&<button className="button button--primary button--full" disabled={busy} onClick={()=>void act('approve-placement',{worksiteId:p.worksiteId,id:p.id,confirmed:true})}>{tx('approvePlacement')}</button>}{p.state!=='revoked'&&<button className="button button--outline button--full" disabled={busy} onClick={()=>void act('revoke-placement',{worksiteId:p.worksiteId,id:p.id})}>{tx('revoke')}</button>}</article>)}
 {canWrite&&<form className="auth-form" onSubmit={e=>{e.preventDefault();if(!canWrite)return;void act(editing?'correct':'create',{worksiteId:site,membershipId:worker,operationId:op.current,localDate:date,startTime:start,endTime:end,breakStatus:pause?'taken':'not-taken',breakMinutes:pause,breakTreatment:paid?'paid':'unpaid',comment,...(editing?{id:editing.id,revision:editing.revision,reason:note}:{})})}}>
 <h3>{tt(editing?'correctTitle':'newShift')}</h3>{leader&&<label className="field-label">{tt('workerRef')}<select value={worker} required disabled={busy||!!editing} onChange={e=>{setWorker(e.target.value);dirty()}}><option value="">{tt('choose')}</option>{rows.map(a=><option value={a.membershipId} key={a.membershipId}>{a.agencyName} · {label(a.membershipId)}</option>)}</select></label>}

 <label className="field-label">{tt('date')}<input type="date" required value={date} disabled={busy} onInput={e=>{setDate(e.currentTarget.value);dirty()}} onChange={e=>{setDate(e.target.value);dirty()}}/></label>
 <div className="timecards-pair"><label className="field-label">{tt('start')}<input type="time" required value={start} disabled={busy} onInput={e=>{setStart(e.currentTarget.value);dirty()}} onChange={e=>{setStart(e.target.value);dirty()}}/></label><label className="field-label">{tt('end')}<input type="time" required value={end} disabled={busy} onInput={e=>{setEnd(e.currentTarget.value);dirty()}} onChange={e=>{setEnd(e.target.value);dirty()}}/></label></div><p>{tt('overnight')} {tt('zone')}</p>
 <label className="field-label">{tt('break')}<input type="number" min="0" max="1439" required value={pause} disabled={busy} onInput={e=>{setPause(Number(e.currentTarget.value));dirty()}} onChange={e=>{setPause(Number(e.target.value));dirty()}}/></label><label className="timecards-check"><input type="checkbox" checked={paid} disabled={busy||!pause} onChange={e=>{setPaid(e.target.checked);dirty()}}/>{tt('paidBreak')}</label>
 <label className="field-label">{tt('comment')}<small className="muted-copy">{t('hostedPrivacy.noteHint')}</small><input value={comment} maxLength={500} disabled={busy} onChange={e=>{setComment(e.target.value);dirty()}}/></label>
 {editing&&<label className="field-label">{tt('reason')}<small className="muted-copy">{t('hostedPrivacy.noteHint')}</small><input value={note} minLength={2} maxLength={500} required disabled={busy} onChange={e=>{setNote(e.target.value);dirty()}}/></label>}
 <button className="button button--primary button--full" disabled={busy||!site||leader&&!worker}>{tt(editing?'saveCorrection':'save')}</button>{editing&&<button type="button" className="button button--outline" onClick={()=>{setEditing(undefined);dirty()}}>{tt('cancel')}</button>}
 </form>}
  {factoryAdmin&&<div className="timecards-pair">
  <label className="field-label">{t('exports.periodMonth')}<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setWorkerFilter('')}}/></label>
  <label className="field-label">{tx('workerRef')}<select value={workerFilter} onChange={e=>setWorkerFilter(e.target.value)}><option value="">{t('common.all')}</option>{Array.from(new Set(administrationRows.map(s=>s.membership_id))).sort((a,b)=>label(a).localeCompare(label(b),i18n.language)||a.localeCompare(b)).map(id=><option key={id} value={id}>{label(id)}</option>)}</select></label>
 </div>}
 <h3>{tt('shifts')}</h3>{factoryAdmin&&!administrationRows.length&&<p>{tt('noShifts')}</p>}
 {(factoryAdmin?administrationRows.filter(s=>!workerFilter||s.membership_id===workerFilter):context.shifts.filter(s=>!site||s.worksite_id===site)).map(s=><article className="notice-box" key={s.id}><h3>{s.data.localDate} · {context.sites.find(w=>w.id===s.worksite_id)?.name}</h3><strong>{tx(s.sent?'sent':s.state)}</strong><p>{s.data.startTime}–{s.data.endTime} · {minutesLabel(s.data.paidMinutes)}</p><p>{organizationLabel(s.membership_id)} / {label(s.membership_id)}</p><p>{s.data.comment}</p>
 {!s.sent&&<>{leader&&s.source==='self'&&s.state==='needs-review'&&<button className="button button--primary" disabled={busy} onClick={()=>void act('review',{worksiteId:s.worksite_id,id:s.id,revision:s.revision})}>{tx('review')}</button>}
 {own&&s.source==='attendance'&&s.state==='needs-confirmation'&&<><button className="button button--primary" disabled={busy} onClick={()=>void act('confirm',{worksiteId:s.worksite_id,id:s.id,revision:s.revision})}>{tx('confirm')}</button><label className="field-label">{tx('disputeReason')}<small className="muted-copy">{t('hostedPrivacy.noteHint')}</small><input value={note} maxLength={500} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><button className="button button--outline" disabled={busy||note.trim().length<2} onClick={()=>void act('dispute',{worksiteId:s.worksite_id,id:s.id,revision:s.revision,note})}>{tx('dispute')}</button></>}
 {(leader&&s.source==='attendance')&&<button className="button button--outline" disabled={busy} onClick={()=>edit(s)}>{tt('edit')}</button>}</>}
 {!(own&&readOnlyWorker)&&<button className="button button--outline" disabled={busy} onClick={()=>void act('history',{worksiteId:s.worksite_id,id:s.id})}>{tt('history')}</button>}</article>)}
 </>}
 {!archiveOnly&&leader&&leaderSection!=='hours'&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('send',{worksiteId:site,agencyId:agency,dateFrom:from,dateTo:to,confirmed})}}>
 <h3>{tx('sendTitle')}</h3><label className="field-label">{tx('recipient')}<select value={agency} required disabled={busy} onChange={e=>{setAgency(e.target.value);setConfirmed(false)}}><option value="">{tt('choose')}</option>{context.agencies.filter(a=>a.worksiteId===site).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 <div className="timecards-pair"><label className="field-label">{tt('from')}<input type="date" value={from} required disabled={busy} onInput={e=>{setFrom(e.currentTarget.value);setConfirmed(false)}} onChange={e=>{setFrom(e.target.value);setConfirmed(false)}}/></label><label className="field-label">{tt('to')}<input type="date" value={to} required disabled={busy} onInput={e=>{setTo(e.currentTarget.value);setConfirmed(false)}} onChange={e=>{setTo(e.target.value);setConfirmed(false)}}/></label></div>
 <p>{tx('sealHint')}</p><label className="timecards-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{tx('sealConfirm')}</label><button className="button button--primary button--full" disabled={busy||!site||!agency||!confirmed}>{tx('send')}</button></form>}
 {leaderSection!=='hours'&&['agency_admin','team_leader','factory_admin'].includes(context.role)&&<>{!archiveOnly&&<h3>{tx(leader||factoryAdmin?'sent':'received')}</h3>}{!context.archive.some(a=>!factoryAdmin||!site||a.worksiteId===site)&&<p>{tt('noArchive')}</p>}{context.archive.filter(a=>!factoryAdmin||!site||a.worksiteId===site).map(a=><article className="notice-box" key={a.id}><h3>{a.snapshot.factoryName} · {a.snapshot.worksiteName}</h3><p>{a.dateFrom} - {a.dateTo} · {tx(leader||factoryAdmin?'sent':'received')}</p><p>{a.snapshot.agencyName} · {minutesLabel(a.snapshot.paidMinutes)}</p><button className="button button--outline" disabled={busy} onClick={()=>void act('read/'+a.id)}>{tt('open')}</button></article>)}
 {snapshot&&<section className="notice-box"><h3>{snapshot.factoryName} · {snapshot.worksiteName}</h3><p>{snapshot.dateFrom} – {snapshot.dateTo} · {snapshot.agencyName} · Europe/Warsaw</p>{snapshot.rows.map(r=><p key={r.id}>{r.data.localDate} {r.data.startTime}–{r.data.endTime} · {minutesLabel(r.data.paidMinutes)}<br/><span>{workerLabelText(r.workerLabel,t('memberNames.historicalMissing'),t('memberNames.reference'))}</span></p>)}<p>{tt('counted')}: {minutesLabel(snapshot.paidMinutes)}</p><a href={blob} download={'Timeax-factory-'+snapshot.dateFrom+'-'+snapshot.dateTo+'.csv'} className="button button--primary button--full">{tt('download')}</a></section>}
 </>}
 {history&&<section className="notice-box"><h3>{tt('history')}</h3>{history.map((e,i)=><p key={i}>{tx(e.action)}: {e.after?.data?.startTime}–{e.after?.data?.endTime} · {e.note}</p>)}</section>}
 </>}
 {notice&&<p role={notice==='saved'?'status':'alert'}>{notice==='saved'?tx('saved'):tt(['login','denied','invalid','conflict','period-closed'].includes(notice)?notice:'uncertain')}{notice==='unresolved'&&' '+tx('unresolved')}</p>}
 <button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={()=>setRefresh(n=>n+1)}>{tt('refresh')}</button>
 </section>;
}
export function FactoryTimecardsPage(){
 const {t}=useTranslation(),loc=useLocation(),org=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/factory-timecards$/)?.[1];const [revision,setRevision]=useState(0),[access,setAccess]=useState(0);
 return <RegistrationFrame title={t('factoryHours.title')} lead={t('factoryHours.lead')}>
 {!isWorkerLocal()&&<><PrivateAccess onOpened={()=>{setAccess(n=>n+1);setRevision(n=>n+1)}}/><StagingSessionPanel key={access} guided purpose="existing" audience="workspace" onChanged={()=>setRevision(n=>n+1)}/></>}
 {org&&<><FactoryTimecardsPanel organizationId={org} revision={revision}/><Link to={'/workspace/'+org}>{t('timecards.back')}</Link></>}
 </RegistrationFrame>;
}
