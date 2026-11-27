import {workerShiftCopy} from './worker-shift-copy';
import {useMemberNames} from './MemberNames';
import {workerLabelText} from './member-label';
import {FactoryTimecardsPanel} from './FactoryTimecardsPage';
import {useEffect,useMemo,useRef,useState} from 'react';import {Link,useLocation} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';import {PrivateAccess} from './PrivateAccess';import {isWorkerLocal} from './worker-enrollment';
import {timecardCall,parseTimecards,parseSnapshot,snapshotCsv,minutesLabel,type TimecardContext,type Snapshot,type ShiftData} from './timecards';
import '../styles/worker-enrollment.css';import '../styles/timecards.css';
const yesterday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));
export function TimecardsPanel({organizationId,revision=0,includeFactoryArchive=true}:{organizationId:string;revision?:number;includeFactoryArchive?:boolean;readOnlyWorker?:boolean}){
 const {t,i18n}=useTranslation(),tx=(k:string)=>t('timecards.'+k);
 const [context,setContext]=useState<TimecardContext>(),[status,setStatus]=useState('checking'),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const {label}=useMemberNames(organizationId,revision+refresh);
 const [site,setSite]=useState('');
 const [from,setFrom]=useState(yesterday),[to,setTo]=useState(yesterday),[confirmed,setConfirmed]=useState(false),[snapshot,setSnapshot]=useState<Snapshot>(),[history,setHistory]=useState<{revision:number;data:ShiftData;reason:string;createdAt:string}[]>();
 const inflight=useRef(false);
 const reload=()=>{setContext(undefined);setRefresh(n=>n+1)};
 useEffect(()=>{const c=new AbortController();setContext(undefined);setStatus('checking');void timecardCall(organizationId,'context',undefined,c.signal).then(v=>parseTimecards(v,organizationId)).then(v=>{if(!c.signal.aborted){setContext(v);setStatus('ready')}}).catch(e=>{if(!c.signal.aborted)setStatus(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>c.abort()},[organizationId,revision,refresh]);
 useEffect(()=>{setHistory(undefined);setSnapshot(undefined)},[organizationId,revision]);
 const csvUrl=useMemo(()=>snapshot?URL.createObjectURL(new Blob([snapshotCsv(snapshot)],{type:'text/csv;charset=utf-8'})):undefined,[snapshot]);
 useEffect(()=>()=>{if(csvUrl)URL.revokeObjectURL(csvUrl)},[csvUrl]);
 async function act(action:string,body?:unknown){if(inflight.current)return;inflight.current=true;setBusy(true);setNotice('');try{
  const result=await timecardCall(organizationId,action,body);
  if(action==='archive'){const r=result as {id:string};setSnapshot(parseSnapshot(await timecardCall(organizationId,'read/'+r.id),organizationId));setConfirmed(false);setNotice('archivedNotice');reload()}
  else if(action.startsWith('read/'))setSnapshot(parseSnapshot(result,organizationId));
  else if(action.startsWith('history/')){const h=result as {revisions:typeof history};if(!Array.isArray(h.revisions))throw Error('unavailable');setHistory(h.revisions)}
 }catch(e){const k=(e as Error).message;setNotice(['invalid','conflict','period-closed','denied','login'].includes(k)?k:'uncertain');reload()}finally{inflight.current=false;setBusy(false)}}
 return <section className="worker-enrollment timecards" aria-busy={busy}>
 {!context?<><p role="status">{tx(status)}</p>{status==='login'&&<Link to="/login">{t('common.login')}</Link>}</>:<>
 {context.role==='worker'?<p><Link to={'/workspace/'+organizationId}>{workerShiftCopy(i18n.language).back}</Link></p>:<>
 <p className="notice-box">{tx('agencyHint')}</p><p>{tx('zone')}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();void act('archive',{worksiteId:site,dateFrom:from,dateTo:to,confirmed})}}>
 <h2>{tx('archiveTitle')}</h2><label className="field-label">{tx('site')}<select required disabled={busy} value={site} onChange={e=>{setSite(e.target.value);setConfirmed(false)}}><option value="">{tx('choose')}</option>{context.worksites.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
 <div className="timecards-pair"><label className="field-label">{tx('from')}<input type="date" required disabled={busy} value={from} onInput={e=>{setFrom(e.currentTarget.value);setConfirmed(false)}} onChange={e=>{setFrom(e.target.value);setConfirmed(false)}}/></label><label className="field-label">{tx('to')}<input type="date" required disabled={busy} value={to} onInput={e=>{setTo(e.currentTarget.value);setConfirmed(false)}} onChange={e=>{setTo(e.target.value);setConfirmed(false)}}/></label></div>
 <p className="notice-box">{tx('sealHint')}</p><label className="timecards-check"><input required type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{tx('sealConfirm')}</label>
 <button className="button button--primary button--full" disabled={busy||!site||!confirmed}>{tx('archiveAction')}</button>
 </form></>}
 <h2>{tx('shifts')}</h2>{!context.shifts.length&&<p>{tx('noShifts')}</p>}
 {context.shifts.filter(s=>(!site||s.worksiteId===site)&&(context.role==='worker'||s.data.localDate>=from&&s.data.localDate<=to)).map(s=><article className="notice-box timecards-row" key={s.id}>
 <h3>{s.data.localDate} · {s.worksiteName}</h3><strong>{tx(s.state)}</strong><p>{s.data.startTime}–{s.data.endTime} · {tx('counted')}: {minutesLabel(s.data.paidMinutes)}</p>
 <p>{tx('break')}: {s.data.breakStatus==='not-reported'?t('workflow.breakReport.none'):s.data.breakStatus==='not-taken'?t('breaks.notTaken'):s.data.breakTreatment==='paid'?t('workflow.breakReport.paidChoice'):minutesLabel(s.data.breakMinutes)}</p><p>{s.data.comment}</p>
 {context.role==='agency_admin'&&<p className="muted-copy">{tx('workerRef')}: {label(s.membershipId)}</p>}
 <div className="timecards-actions"><button className="button button--outline" disabled={busy} onClick={()=>void act('history/'+s.id)}>{tx('history')}</button></div>
 </article>)}
 {context.role==='agency_admin'&&<><h2>{tx('archive')}</h2>{!context.archive.length&&<p>{tx('noArchive')}</p>}{context.archive.map(a=><article className="notice-box timecards-row" key={a.id}><h3>{a.worksiteName}</h3><p>{a.dateFrom} – {a.dateTo} · {tx('archived')}</p><p>{tx('counted')}: {minutesLabel(a.paidMinutes)}</p><button className="button button--outline" disabled={busy} onClick={()=>void act('read/'+a.id)}>{tx('open')}</button></article>)}</>}
 </>}
 {context&&history&&<section className="notice-box"><h2>{tx('history')}</h2>{history.map(h=><p key={h.revision}>{tx('version')} {h.revision}: {h.data.localDate} {h.data.startTime}–{h.data.endTime}; {h.reason==='created'?tx('created'):h.reason}</p>)}<button className="button button--outline" onClick={()=>setHistory(undefined)}>{tx('close')}</button></section>}
 {context?.role==='agency_admin'&&snapshot?.organizationId===organizationId&&snapshot&&<section className="notice-box timecards-snapshot"><h2>{tx('document')}: {snapshot.worksiteName}</h2><p>{snapshot.dateFrom} – {snapshot.dateTo} · Europe/Warsaw · {tx('archived')}</p><p>{tx('counted')}: {minutesLabel(snapshot.paidMinutes)}</p>{snapshot.rows.map(r=><p key={r.id}>{r.data.localDate} {r.data.startTime}–{r.data.endTime} · {minutesLabel(r.data.paidMinutes)}<br/><small>{tx('workerRef')}: {workerLabelText(r.workerLabel,t('memberNames.historicalMissing'),t('memberNames.reference'))}</small></p>)}<a className="button button--primary button--full" href={csvUrl} download={'Timeax-'+snapshot.dateFrom+'-'+snapshot.dateTo+'.csv'}>{tx('download')}</a><button className="button button--outline button--full" onClick={()=>setSnapshot(undefined)}>{tx('close')}</button></section>}
 {notice&&<p role={['saved','archivedNotice'].includes(notice)?'status':'alert'}>{tx(notice)}</p>}
 {includeFactoryArchive&&context?.role==='agency_admin'&&<FactoryTimecardsPanel organizationId={organizationId} revision={revision} archiveOnly/>}<button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={reload}>{tx('refresh')}</button>
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
