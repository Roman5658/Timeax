import {TemplatePicker} from './TeamWorkflow';
import {useMemberNames} from './MemberNames';
import {workerLabelText} from './member-label';
import {FactoryTimecardsPanel} from './FactoryTimecardsPage';
import {useEffect,useMemo,useRef,useState} from 'react';import {Link,useLocation} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';import {PrivateAccess} from './PrivateAccess';import {isWorkerLocal} from './worker-enrollment';
import {timecardCall,parseTimecards,parseSnapshot,snapshotCsv,minutesLabel,type TimecardContext,type TimecardShift,type Snapshot,type ShiftData} from './timecards';
import {WorkerShiftCalendar} from './WorkerShiftCalendar';
import '../styles/worker-enrollment.css';import '../styles/timecards.css';
const yesterday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
export function TimecardsPanel({organizationId,revision=0}:{organizationId:string;revision?:number}){
 const {t}=useTranslation(),tx=(k:string)=>t('timecards.'+k);
 const [context,setContext]=useState<TimecardContext>(),[status,setStatus]=useState('checking'),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const {label}=useMemberNames(organizationId,revision+refresh);
 const [site,setSite]=useState(''),[date,setDate]=useState(yesterday),[start,setStart]=useState('08:00'),[end,setEnd]=useState('16:00'),[breakMinutes,setBreakMinutes]=useState(0),[paid,setPaid]=useState(false),[comment,setComment]=useState(''),[reason,setReason]=useState('');
 const [editing,setEditing]=useState<TimecardShift>(),[from,setFrom]=useState(yesterday),[to,setTo]=useState(yesterday),[confirmed,setConfirmed]=useState(false),[snapshot,setSnapshot]=useState<Snapshot>(),[history,setHistory]=useState<{revision:number;data:ShiftData;reason:string;createdAt:string}[]>();
 const operation=useRef(crypto.randomUUID()),inflight=useRef(false);
 const dirty=()=>{operation.current=crypto.randomUUID();setNotice('')};
 const reload=()=>{setContext(undefined);setRefresh(n=>n+1)};
 useEffect(()=>{const c=new AbortController();setContext(undefined);setStatus('checking');void timecardCall(organizationId,'context',undefined,c.signal).then(v=>parseTimecards(v,organizationId)).then(v=>{if(!c.signal.aborted){setContext(v);setStatus('ready')}}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>c.abort()},[organizationId,revision,refresh]);
 useEffect(()=>{setHistory(undefined);setSnapshot(undefined)},[organizationId,revision]);
 const csvUrl=useMemo(()=>snapshot?URL.createObjectURL(new Blob([snapshotCsv(snapshot)],{type:'text/csv;charset=utf-8'})):undefined,[snapshot]);
 useEffect(()=>()=>{if(csvUrl)URL.revokeObjectURL(csvUrl)},[csvUrl]);
 async function act(action:string,body?:unknown){if(inflight.current)return;inflight.current=true;setBusy(true);setNotice('');try{
  const result=await timecardCall(organizationId,action,body);
  if(action==='create'||action==='correct'){setEditing(undefined);setReason('');operation.current=crypto.randomUUID();setNotice('saved');reload()}
  else if(action==='archive'){const r=result as {id:string};setSnapshot(parseSnapshot(await timecardCall(organizationId,'read/'+r.id),organizationId));setConfirmed(false);setNotice('archivedNotice');reload()}
  else if(action.startsWith('read/'))setSnapshot(parseSnapshot(result,organizationId));
  else if(action.startsWith('history/')){const h=result as {revisions:typeof history};if(!Array.isArray(h.revisions))throw Error('unavailable');setHistory(h.revisions)}
 }catch(e){const k=(e as Error).message;setNotice(['invalid','conflict','period-closed','denied','login'].includes(k)?k:'uncertain');reload()}finally{inflight.current=false;setBusy(false)}}
 function edit(s:TimecardShift){setEditing(s);setSite(s.worksiteId);setDate(s.data.localDate);setStart(s.data.startTime);setEnd(s.data.endTime);setBreakMinutes(s.data.breakMinutes);setPaid(s.data.breakTreatment==='paid');setComment(s.data.comment);setReason('');dirty()}
 const canWrite=context?.role==='worker'&&context.worksites.some(w=>w.id===site);
 return <section className="worker-enrollment timecards" aria-busy={busy}>
 {!context?<><p role="status">{tx(status)}</p><Link to="/login">{t('common.login')}</Link></>:<>
 <p className="notice-box">{tx(context.role==='worker'?'workerHint':'agencyHint')}</p><p>{tx('zone')}</p>
 {context.role==='worker'?<>
 <TemplatePicker organizationId={organizationId} disabled={busy||!!editing} onApply={v=>{setStart(v.startTime);setEnd(v.endTime);setBreakMinutes(v.breakMinutes);setPaid(v.breakTreatment==='paid');dirty()}}/>
 <WorkerShiftCalendar value={date} shifts={context.shifts} disabled={busy||!!editing||!context.worksites.length} onSelect={day=>{setDate(day);dirty()}}/>
 {!context.worksites.length?<p role="status">{tx('noAssignment')}</p>:<form className="auth-form" onSubmit={e=>{e.preventDefault();if(!canWrite)return;void act(editing?'correct':'create',{worksiteId:site,operationId:operation.current,localDate:date,startTime:start,endTime:end,breakMinutes,breakStatus:breakMinutes?'taken':'not-taken',breakTreatment:paid?'paid':'unpaid',comment,...(editing?{id:editing.id,revision:editing.revision,reason}:{})})}}>
 <h2>{tx(editing?'correctTitle':'newShift')}</h2><label className="field-label">{tx('site')}<select required disabled={busy||!!editing} value={site} onChange={e=>{setSite(e.target.value);dirty()}}><option value="">{tx('choose')}</option>{context.worksites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
 <label className="field-label">{tx('date')}<input required type="date" value={date} disabled={busy} onInput={e=>{setDate(e.currentTarget.value);dirty()}} onChange={e=>{setDate(e.target.value);dirty()}}/></label>
 <div className="timecards-pair"><label className="field-label">{tx('start')}<input required type="time" value={start} disabled={busy} onInput={e=>{setStart(e.currentTarget.value);dirty()}} onChange={e=>{setStart(e.target.value);dirty()}}/></label><label className="field-label">{tx('end')}<input required type="time" value={end} disabled={busy} onInput={e=>{setEnd(e.currentTarget.value);dirty()}} onChange={e=>{setEnd(e.target.value);dirty()}}/></label></div>
 <p className="muted-copy">{tx('overnight')}</p>
 <label className="field-label">{tx('break')}<input required type="number" min="0" max="1439" value={breakMinutes} disabled={busy} onChange={e=>{setBreakMinutes(Number(e.target.value));dirty()}}/></label>
 <label className="timecards-check"><input type="checkbox" checked={paid} disabled={busy||!breakMinutes} onChange={e=>{setPaid(e.target.checked);dirty()}}/>{tx('paidBreak')}</label>
 <label className="field-label">{tx('comment')}<small className="muted-copy">{t('hostedPrivacy.noteHint')}</small><textarea maxLength={500} value={comment} disabled={busy} onChange={e=>{setComment(e.target.value);dirty()}}/></label>
 {editing&&<label className="field-label">{tx('reason')}<small className="muted-copy">{t('hostedPrivacy.noteHint')}</small><input required minLength={2} maxLength={500} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);dirty()}}/></label>}
 <button className="button button--primary button--full" disabled={busy||!canWrite}>{tx(editing?'saveCorrection':'save')}</button>
 {editing&&<button type="button" className="button button--outline button--full" onClick={()=>{setEditing(undefined);dirty()}}>{tx('cancel')}</button>}
 </form>}
 </>:<form className="auth-form" onSubmit={e=>{e.preventDefault();void act('archive',{worksiteId:site,dateFrom:from,dateTo:to,confirmed})}}>
 <h2>{tx('archiveTitle')}</h2><label className="field-label">{tx('site')}<select required disabled={busy} value={site} onChange={e=>{setSite(e.target.value);setConfirmed(false)}}><option value="">{tx('choose')}</option>{context.worksites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
 <div className="timecards-pair"><label className="field-label">{tx('from')}<input type="date" required disabled={busy} value={from} onInput={e=>{setFrom(e.currentTarget.value);setConfirmed(false)}} onChange={e=>{setFrom(e.target.value);setConfirmed(false)}}/></label><label className="field-label">{tx('to')}<input type="date" required disabled={busy} value={to} onInput={e=>{setTo(e.currentTarget.value);setConfirmed(false)}} onChange={e=>{setTo(e.target.value);setConfirmed(false)}}/></label></div>
 <p className="notice-box">{tx('sealHint')}</p><label className="timecards-check"><input required type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{tx('sealConfirm')}</label>
 <button className="button button--primary button--full" disabled={busy||!site||!confirmed}>{tx('archiveAction')}</button>
 </form>}
 <h2>{tx('shifts')}</h2>{!context.shifts.length&&<p>{tx('noShifts')}</p>}
 {context.shifts.filter(s=>(!site||s.worksiteId===site)&&(context.role==='worker'||s.data.localDate>=from&&s.data.localDate<=to)).map(s=><article className="notice-box timecards-row" key={s.id}>
 <h3>{s.data.localDate} · {s.worksiteName}</h3><strong>{tx(s.state)}</strong><p>{s.data.startTime}–{s.data.endTime} · {tx('counted')}: {minutesLabel(s.data.paidMinutes)}</p>
 <p>{tx('break')}: {s.data.breakMinutes} · {tx(s.data.breakTreatment)}</p><p>{s.data.comment}</p>
 {context.role==='agency_admin'&&<p className="muted-copy">{tx('workerRef')}: {label(s.membershipId)}</p>}
 <div className="timecards-actions">{context.role==='worker'&&s.state==='recorded'&&context.worksites.some(w=>w.id===s.worksiteId)&&<button className="button button--outline" disabled={busy} onClick={()=>edit(s)}>{tx('edit')}</button>}<button className="button button--outline" disabled={busy} onClick={()=>void act('history/'+s.id)}>{tx('history')}</button></div>
 </article>)}
 {context.role==='agency_admin'&&<><h2>{tx('archive')}</h2>{!context.archive.length&&<p>{tx('noArchive')}</p>}{context.archive.map(a=><article className="notice-box timecards-row" key={a.id}><h3>{a.worksiteName}</h3><p>{a.dateFrom} – {a.dateTo} · {tx('archived')}</p><p>{tx('counted')}: {minutesLabel(a.paidMinutes)}</p><button className="button button--outline" disabled={busy} onClick={()=>void act('read/'+a.id)}>{tx('open')}</button></article>)}</>}
 </>}
 {context&&history&&<section className="notice-box"><h2>{tx('history')}</h2>{history.map(h=><p key={h.revision}>{tx('version')} {h.revision}: {h.data.localDate} {h.data.startTime}–{h.data.endTime}; {h.reason==='created'?tx('created'):h.reason}</p>)}<button className="button button--outline" onClick={()=>setHistory(undefined)}>{tx('close')}</button></section>}
 {context?.role==='agency_admin'&&snapshot?.organizationId===organizationId&&snapshot&&<section className="notice-box timecards-snapshot"><h2>{tx('document')}: {snapshot.worksiteName}</h2><p>{snapshot.dateFrom} – {snapshot.dateTo} · Europe/Warsaw · {tx('archived')}</p><p>{tx('counted')}: {minutesLabel(snapshot.paidMinutes)}</p>{snapshot.rows.map(r=><p key={r.id}>{r.data.localDate} {r.data.startTime}–{r.data.endTime} · {minutesLabel(r.data.paidMinutes)}<br/><small>{tx('workerRef')}: {workerLabelText(r.workerLabel,t('memberNames.historicalMissing'),t('memberNames.reference'))}</small></p>)}<a className="button button--primary button--full" href={csvUrl} download={'Timeax-'+snapshot.dateFrom+'-'+snapshot.dateTo+'.csv'}>{tx('download')}</a><button className="button button--outline button--full" onClick={()=>setSnapshot(undefined)}>{tx('close')}</button></section>}
 {notice&&<p role={['saved','archivedNotice'].includes(notice)?'status':'alert'}>{tx(notice)}</p>}
 {context?.role==='agency_admin'&&<FactoryTimecardsPanel organizationId={organizationId} revision={revision} archiveOnly/>}<button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={reload}>{tx('refresh')}</button>
 <Link to={'/workspace/'+organizationId}>{tx('back')}</Link>
 </section>;
}
export function TimecardsPage(){
 const loc=useLocation(),{t}=useTranslation(),org=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/timecards$/)?.[1];
 const [revision,setRevision]=useState(0),[access,setAccess]=useState(0);
 return <RegistrationFrame title={t('timecards.title')} lead={t('timecards.lead')}>
 {!isWorkerLocal()&&<><PrivateAccess onOpened={()=>{setAccess(n=>n+1);setRevision(n=>n+1)}}/><StagingSessionPanel key={access} guided purpose="existing" audience="workspace" onChanged={()=>setRevision(n=>n+1)}/></>}
 {org&&<TimecardsPanel organizationId={org} revision={revision}/>}</RegistrationFrame>;
}
