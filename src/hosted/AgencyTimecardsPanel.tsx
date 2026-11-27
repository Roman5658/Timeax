import {useEffect,useState,useRef,useId} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useMemberNames} from './MemberNames';
import {workerLabelText} from './member-label';
import {agencyTimecardsCopy} from './agency-timecards-copy';
import {timecardCall,parseTimecards,parseSnapshot,minutesLabel,type TimecardContext,type ShiftData} from './timecards';
import {factoryHoursCall,parseFactoryHours,parseFactorySnapshot,type FactoryHoursContext} from './factory-timecards';
import type {AgencyTimecardSnapshot} from './timecard-xlsx';
import '../styles/timecards.css';
import '../styles/agency-hours.css';

type Source='internal'|'factory';
type Copy=ReturnType<typeof agencyTimecardsCopy>;
type DocumentRow={id:string;name:string;worksiteId:string;dateFrom:string;dateTo:string;paidMinutes:number;factoryName?:string};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
function currentMonth(){
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return {from:today.slice(0,8)+'01',to:today};
}
export function AgencyTimecardsPanel({organizationId,internalEnabled,factoryEnabled,initialSource='internal'}:{
  organizationId:string; internalEnabled:boolean; factoryEnabled:boolean; initialSource?:Source;
}){
  const {t,i18n}=useTranslation(),c=agencyTimecardsCopy(i18n.language);
  const [selected,setSelected]=useState<Source>(initialSource);
  useEffect(()=>setSelected(initialSource),[initialSource]);
  const enabled={internal:internalEnabled,factory:factoryEnabled};
  const source=enabled[selected]?selected:enabled.internal?'internal':'factory';
  if(!internalEnabled&&!factoryEnabled)return <p role="status">{t('timecards.unavailable')}</p>;
  return <section className="agency-hours">
    <div className="agency-hours__sources" role="group" aria-label={c.source}>
      <button type="button" className={'button '+(source==='internal'?'button--primary':'button--outline')} aria-pressed={source==='internal'} disabled={!internalEnabled} onClick={()=>setSelected('internal')}>{c.internal}</button>
      <button type="button" className={'button '+(source==='factory'?'button--primary':'button--outline')} aria-pressed={source==='factory'} disabled={!factoryEnabled} onClick={()=>setSelected('factory')}>{c.factory}</button>
    </div>
    <AgencySource key={organizationId+':'+source} organizationId={organizationId} source={source} c={c}/>
  </section>;
}

function AgencySource({organizationId,source,c}:{organizationId:string;source:Source;c:Copy}){
  const {t,i18n}=useTranslation(),tt=(k:string)=>t('timecards.'+k);
  const dialogId=useId();
  const [data,setData]=useState<TimecardContext|FactoryHoursContext>(),[status,setStatus]=useState('checking'),[revision,setRevision]=useState(0);
  const [site,setSite]=useState(''),[worker,setWorker]=useState(''),[{from,to},setPeriod]=useState(currentMonth);
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[snapshot,setSnapshot]=useState<AgencyTimecardSnapshot>();
  const pending=useRef<AbortController|null>(null);
  const [history,setHistory]=useState<{revision:number;data:ShiftData;reason:string}[]>();
  const {label}=useMemberNames(source==='internal'?organizationId:undefined,revision);
  useEffect(()=>{
    const controller=new AbortController();
    setStatus('checking');
    const promise=source==='internal'
      ?timecardCall(organizationId,'context',undefined,controller.signal).then(v=>parseTimecards(v,organizationId))
      :factoryHoursCall(organizationId,'context',undefined,controller.signal).then(v=>parseFactoryHours(v,organizationId));
    void promise.then(result=>{
      if(result.role!=='agency_admin')throw Error('denied');
      if(!controller.signal.aborted){setData(result);setStatus('ready')}
    }).catch(error=>{
      if(!controller.signal.aborted){setData(undefined);setSnapshot(undefined);setStatus(['login','denied'].includes(error.message)?error.message:'unavailable')}
    });
    return ()=>controller.abort();
  },[organizationId,source,revision]);
  useEffect(()=>()=>pending.current?.abort(),[]);

  const periodValid=!!from&&!!to&&from<=to;
  const internal=data&&'worksites' in data?data:undefined;
  const factory=data&&'sites' in data?data:undefined;
  const periodShifts=(internal?.shifts??[]).filter(row=>(!site||site===row.worksiteId)&&periodValid&&row.data.localDate>=from&&row.data.localDate<=to);
  const workers=[...new Set(periodShifts.map(row=>row.membershipId))].sort((a,b)=>label(a).localeCompare(label(b),i18n.language));
  const filteredShifts=periodShifts.filter(row=>!worker||row.membershipId===worker).sort((a,b)=>b.data.localDate.localeCompare(a.data.localDate)||a.data.startTime.localeCompare(b.data.startTime));
  const documents:DocumentRow[]=internal?internal.archive.map(row=>({...row,name:row.worksiteName})):
    (factory?.archive??[]).map(row=>({id:row.id,name:row.snapshot.worksiteName,worksiteId:row.worksiteId,dateFrom:row.dateFrom,dateTo:row.dateTo,paidMinutes:row.snapshot.paidMinutes,factoryName:row.snapshot.factoryName}));
  const sites=source==='internal'?new Map((internal?.worksites??[]).map(s=>[s.id,s.name])):new Map([...(factory?.sites??[]).map(s=>[s.id,s.name] as const),...documents.map(d=>[d.worksiteId,d.name] as const)]);
  const filteredDocuments=documents.filter(row=>(!site||row.worksiteId===site)&&(source==='internal'||(periodValid&&row.dateFrom<=to&&row.dateTo>=from))).sort((a,b)=>b.dateTo.localeCompare(a.dateTo)||a.name.localeCompare(b.name,i18n.language));
  const canArchive=source==='internal'&&periodValid&&!!site&&!worker&&periodShifts.some(s=>s.state==='recorded');

  async function act(id:string|null){
    if(pending.current)return;
    const controller=new AbortController();
    pending.current=controller;
    setBusy(true);setNotice('');setSnapshot(undefined);
    try{
      let documentId=id;
      if(!documentId){
        if(!confirmed||!canArchive)return;
        const result=await timecardCall(organizationId,'archive',{worksiteId:site,dateFrom:from,dateTo:to,confirmed:true},controller.signal) as {id?:unknown};
        if(!uuid(result.id))throw Error('uncertain');
        documentId=result.id;
        if(!controller.signal.aborted){setConfirmed(false);setNotice('archivedNotice');setRevision(n=>n+1)}
      }
      if(!uuid(documentId))throw Error('invalid');
      const raw=await (source==='internal'?timecardCall:factoryHoursCall)(organizationId,'read/'+documentId,undefined,controller.signal);
      const saved=source==='internal'?parseSnapshot(raw,organizationId):parseFactorySnapshot((raw as {snapshot?:unknown})?.snapshot);
      if(saved.organizationId!==organizationId)throw Error('denied');
      if(!controller.signal.aborted)setSnapshot(saved);
    }catch(error){
      if(!controller.signal.aborted){
        const key=(error as Error).message;
        setNotice(['invalid','conflict','period-closed','login','denied'].includes(key)?key:'uncertain');
      }
    }finally{
      if(pending.current===controller)pending.current=null;
      if(!controller.signal.aborted)setBusy(false);
    }
  }
  async function readHistory(id:string){
    if(pending.current||!uuid(id))return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setNotice('');setHistory(undefined);
    try{
      const result=await timecardCall(organizationId,'history/'+id,undefined,controller.signal) as {revisions?:unknown};
      if(!Array.isArray(result.revisions))throw Error('unavailable');
      if(!controller.signal.aborted)setHistory(result.revisions);
    }catch(error){
      if(!controller.signal.aborted)setNotice(['login','denied'].includes((error as Error).message)?(error as Error).message:'unavailable');
    }finally{
      if(pending.current===controller)pending.current=null;
      if(!controller.signal.aborted)setBusy(false);
    }
  }
  const updateFilters=()=>{setConfirmed(false);setWorker('');setHistory(undefined)};

  return <section className="agency-hours__source worker-enrollment timecards" aria-busy={busy||status==='checking'}>
    <p className="notice-box">{source==='internal'?c.internalHint:c.factoryHint}</p>
    {!data?<><p role="status">{tt(status)}</p>{status==='login'&&<Link to="/login">{t('common.login')}</Link>}</>:<>
      <div className="agency-hours__filters">
        <label className="field-label">{c.site}<select value={site} disabled={busy} onChange={e=>{setSite(e.target.value);updateFilters()}}><option value="">{c.selectSite}</option>{[...sites].sort((a,b)=>a[1].localeCompare(b[1],i18n.language)).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="field-label">{tt('from')}<input type="date" value={from} disabled={busy} onChange={e=>{setPeriod({from:e.target.value,to});updateFilters()}}/></label>
        <label className="field-label">{tt('to')}<input type="date" value={to} disabled={busy} onChange={e=>{setPeriod({from,to:e.target.value});updateFilters()}}/></label>
        {source==='internal'&&<label className="field-label">{tt('workerRef')}<select value={worker} disabled={busy||!workers.length} onChange={e=>{setWorker(e.target.value);setConfirmed(false)}}><option value="">{c.selectWorker}</option>{workers.map(id=><option value={id} key={id}>{label(id)}</option>)}</select></label>}
      </div>
      {!periodValid&&<p role="alert">{c.invalidRange}</p>}
      {source==='internal'&&<>
        <div className="agency-hours__heading"><h2>{c.matches}</h2><strong>{tt('counted')}: {minutesLabel(filteredShifts.reduce((sum,row)=>sum+row.data.paidMinutes,0))}</strong></div>
        {!filteredShifts.length&&<p>{c.emptyMatch}</p>}
        <div className="agency-hours__rows">
          {filteredShifts.map(row=><article className="notice-box timecards-row" key={row.id}>
            <strong>{label(row.membershipId)} · {row.worksiteName}</strong>
            <p>{row.data.localDate} · {row.data.startTime}–{row.data.endTime} · {tt('counted')}: <strong>{minutesLabel(row.data.paidMinutes)}</strong> · {tt(row.state)}</p>
            <p>{tt('break')}: {row.data.breakMinutes} · {tt(row.data.breakTreatment)}</p>{row.data.comment&&<p>{row.data.comment}</p>}<button type="button" className="button button--outline" disabled={busy} onClick={()=>void readHistory(row.id)}>{tt('history')}</button>
          </article>)}
        </div>
        {history&&<section className="notice-box"><h3>{tt('history')}</h3>{history.map(h=><p key={h.revision}>{tt('version')} {h.revision}: {h.data.localDate} {h.data.startTime}–{h.data.endTime} · {h.reason==='created'?tt('created'):h.reason}</p>)}<button type="button" className="button button--outline" onClick={()=>setHistory(undefined)}>{tt('close')}</button></section>}
        {!site&&periodShifts.length>0&&<p>{c.siteRequired}</p>}
        {canArchive&&<form className="notice-box auth-form" onSubmit={e=>{e.preventDefault();void act(null)}}>
          <h3>{tt('archiveTitle')}</h3><p>{tt('sealHint')}</p>
          <label className="timecards-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{tt('sealConfirm')}</label>
          <button className="button button--primary" disabled={busy||!confirmed}>{tt('archiveAction')}</button>
        </form>}
      </>}
      <div className="agency-hours__heading"><h2>{source==='internal'?c.archive:c.received}</h2></div>
      {!filteredDocuments.length&&<p>{documents.length?c.emptyMatch:source==='internal'?tt('noArchive'):c.emptyReceived}</p>}
      <div className="agency-hours__rows">{filteredDocuments.map(record=><article className="notice-box timecards-row" key={record.id}>
        <strong>{record.factoryName&&record.factoryName+' · '}{record.name}</strong>
        <p>{record.dateFrom} – {record.dateTo} · {tt('counted')}: <strong>{minutesLabel(record.paidMinutes)}</strong></p>
        <button type="button" className="button button--outline" disabled={busy} onClick={()=>void act(record.id)}>{tt('open')}</button>
      </article>)}</div>
      {snapshot&&<SnapshotDialog key={snapshot.source+snapshot.worksiteId+snapshot.dateFrom+snapshot.dateTo} titleId={dialogId} snapshot={snapshot} c={c} onClose={()=>setSnapshot(undefined)}/>}
    </>}
    {notice&&<p role={notice==='archivedNotice'?'status':'alert'}>{tt(notice)}</p>}
    <button type="button" className="button button--outline" disabled={busy||status==='checking'} onClick={()=>{setNotice('');setSnapshot(undefined);setHistory(undefined);setRevision(n=>n+1)}}>{tt('refresh')}</button>
  </section>;
}

function SnapshotDialog({snapshot,c,titleId,onClose}:{snapshot:AgencyTimecardSnapshot;c:Copy;titleId:string;onClose:()=>void}){
  const {t}=useTranslation(),tt=(k:string)=>t('timecards.'+k);
  const dialog=useRef<HTMLDialogElement>(null),saving=useRef(false);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{const el=dialog.current;const current=document.activeElement;el?.showModal();return()=>{el?.close();if(current instanceof HTMLElement)current.focus()}},[]);
  const workerText=(r:AgencyTimecardSnapshot['rows'][number])=>workerLabelText(r.workerLabel,t('memberNames.historicalMissing'),t('memberNames.reference'));
  async function download(){
    if(saving.current)return;saving.current=true;setBusy(true);setFailed(false);
    try{const {downloadAgencyTimecardWorkbook}=await import('./timecard-xlsx');
      await downloadAgencyTimecardWorkbook(snapshot,{source:c.source,site:c.site,factory:c.factoryLabel,worker:tt('workerRef'),date:tt('date'),start:tt('start'),end:tt('end'),gross:c.gross,break:c.break,paid:c.paid,comment:tt('comment'),total:c.total,worksheet:c.workbook,missingName:t('memberNames.historicalMissing'),reference:t('memberNames.reference'),internal:c.internal,factorySource:c.factory,timeZone:c.timeZone});
    }catch{setFailed(true)}finally{saving.current=false;setBusy(false)}
  }
  return <dialog ref={dialog} className="compact-modal agency-hours__document" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
    <h2 id={titleId}>{snapshot.source==='connected-factory'?snapshot.factoryName+' · ':''}{snapshot.worksiteName}</h2>
    <p>{snapshot.dateFrom} – {snapshot.dateTo} · {snapshot.timeZone}</p>
    <p>{tt('counted')}: <strong>{minutesLabel(snapshot.paidMinutes)}</strong></p>
    <div className="agency-hours__rows">
      {snapshot.rows.map(row=><p key={row.id}>{workerText(row)} · {row.data.localDate} · {row.data.startTime}–{row.data.endTime} · <strong>{minutesLabel(row.data.paidMinutes)}</strong></p>)}
    </div>
    <div className="timecards-actions">
      <button type="button" className="button button--primary" disabled={busy} onClick={()=>void download()}>{busy?c.exporting:c.download}</button>
      <button type="button" className="button button--outline" disabled={busy} onClick={onClose}>{tt('close')}</button>
    </div>
    {failed&&<p role="alert">{c.exportError}</p>}
  </dialog>;
}

