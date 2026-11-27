import {useEffect,useState,useRef} from 'react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useMemberNames} from './MemberNames';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {agencyPeriodToday,agencyPeriodBounds,agencyPeriodOverlaps,agencyShiftGroups,weekdays,type AgencyPeriodKind} from './agency-hours-scope';
import {workerLabelText} from './member-label';
import {agencyTimecardsCopy} from './agency-timecards-copy';
import {timecardCall,parseTimecards,parseSnapshot,minutesLabel,type TimecardContext,type ShiftData,type TimecardShift} from './timecards';
import {factoryHoursCall,parseFactoryHours,parseFactorySnapshot,type FactoryHoursContext} from './factory-timecards';
import type {AgencyTimecardSnapshot} from './timecard-xlsx';
import '../styles/timecards.css';
import '../styles/agency-hours.css';

type Source='internal'|'factory';
type Copy=ReturnType<typeof agencyTimecardsCopy>;
type DocumentRow={id:string;name:string;worksiteId:string;dateFrom:string;dateTo:string;paidMinutes:number;factoryName?:string};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
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
  const [data,setData]=useState<TimecardContext|FactoryHoursContext>(),[status,setStatus]=useState('checking'),[revision,setRevision]=useState(0);
  const [site,setSite]=useState(''),[worker,setWorker]=useState(''),[period,setPeriod]=useState(()=>agencyPeriodToday());
  const [search,setSearch]=useState(''),[days,setDays]=useState<readonly number[]>(weekdays),[detail,setDetail]=useState<string>();
  const dayName=new Intl.DateTimeFormat(i18n.language,{weekday:'long',timeZone:'UTC'});
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[snapshot,setSnapshot]=useState<AgencyTimecardSnapshot>();
  const pending=useRef<AbortController|null>(null);
  const [history,setHistory]=useState<{id:string;revisions:{revision:number;data:ShiftData;reason:string}[]}>();
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

  const bounds=agencyPeriodBounds(period);
  const periodValid=bounds!==undefined;
  const internal=data&&'worksites' in data?data:undefined;
  const factory=data&&'sites' in data?data:undefined;
  const baseScope={site,bounds,days,search,label,locale:i18n.language};
  const workers=agencyShiftGroups(internal?.shifts??[],{...baseScope,worker:''});
  const matchingWorkers=worker?workers.filter(group=>group.id===worker):workers;
  const detailGroup=matchingWorkers.find(group=>group.id===detail);
  const documents:DocumentRow[]=internal?internal.archive.map(row=>({...row,name:row.worksiteName})):
    (factory?.archive??[]).map(row=>({id:row.id,name:row.snapshot.worksiteName,worksiteId:row.worksiteId,dateFrom:row.dateFrom,dateTo:row.dateTo,paidMinutes:row.snapshot.paidMinutes,factoryName:row.snapshot.factoryName}));
  const sites=source==='internal'?new Map([...documents.map(d=>[d.worksiteId,d.name] as const),...(internal?.worksites??[]).map(s=>[s.id,s.name] as const)]):new Map([...(factory?.sites??[]).map(s=>[s.id,s.name] as const),...documents.map(d=>[d.worksiteId,d.name] as const)]);
  const filteredDocuments=documents.filter(row=>(!site||row.worksiteId===site)&&agencyPeriodOverlaps(row.dateFrom,row.dateTo,bounds))
    .sort((a,b)=>b.dateTo.localeCompare(a.dateTo)||a.name.localeCompare(b.name,i18n.language));
  // Don't silently apply screen-only employee/search/weekday filters to the whole site archive.
  const archiveBounds=bounds&&period.kind!=='year'?{from:bounds.from,to:[bounds.to,agencyPeriodToday().date].sort()[0]}:null;
  const archiveScope=!!archiveBounds&&archiveBounds.from<=archiveBounds.to&&days.length===weekdays.length&&!search.trim()&&!worker;
  const canArchive=source==='internal'&&archiveScope&&!!site&&internal?.worksites.some(w=>w.id===site)===true&&
   workers.some(g=>g.rows.some(row=>row.state==='recorded'&&row.data.localDate<=archiveBounds!.to));

  async function act(id:string|null){
    if(pending.current)return;
    const controller=new AbortController();
    pending.current=controller;
    setBusy(true);setNotice('');setSnapshot(undefined);
    try{
      let documentId=id;
      if(!documentId){
        if(!confirmed||!canArchive||!archiveBounds)return;
        const result=await timecardCall(organizationId,'archive',{worksiteId:site,dateFrom:archiveBounds.from,dateTo:archiveBounds.to,confirmed:true},controller.signal) as {id?:unknown};
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
      if(!Array.isArray(result.revisions)||result.revisions.some(entry=>!entry||!Number.isInteger(entry.revision)||
        typeof entry.reason!=='string'||typeof entry.data?.localDate!=='string'||typeof entry.data.startTime!=='string'||
        typeof entry.data.endTime!=='string'))throw Error('unavailable');
      if(!controller.signal.aborted)setHistory({id,revisions:result.revisions});
    }catch(error){
      if(!controller.signal.aborted)setNotice(['login','denied'].includes((error as Error).message)?(error as Error).message:'unavailable');
    }finally{
      if(pending.current===controller)pending.current=null;
      if(!controller.signal.aborted)setBusy(false);
    }
  }
  const updateFilters=()=>{setConfirmed(false);setWorker('');setHistory(undefined);setDetail(undefined);setNotice('')};
  function shiftRow(row:TimecardShift){return <article className="notice-box timecards-row" key={row.id}>
    <strong>{row.worksiteName}</strong>
    <p>{row.data.localDate} &middot; {row.data.startTime}-{row.data.endTime} &middot; {tt('counted')}: <strong>{minutesLabel(row.data.paidMinutes)}</strong> &middot; {tt(row.state)}</p>
    <p>{tt('break')}: {row.data.breakStatus==='not-reported'?t('workflow.breakReport.notReported'):row.data.breakStatus==='not-taken'?t('breaks.notTaken'):row.data.breakTreatment==='paid'?t('workflow.breakReport.paidChoice'):`${t('workflow.breakReport.unpaidChoice')} · ${minutesLabel(row.data.breakMinutes)}`}</p>{row.data.comment&&<p>{row.data.comment}</p>}
    <button type="button" className="button button--outline" disabled={busy} onClick={()=>void readHistory(row.id)}>{tt('history')}</button>
    {history?.id===row.id&&<section className="notice-box"><h3>{tt('history')}</h3>{history.revisions.map(h=><p key={h.revision}>{tt('version')} {h.revision}: {h.data.localDate} {h.data.startTime}-{h.data.endTime} &middot; {h.reason==='created'?tt('created'):h.reason}</p>)}<button type="button" className="button button--outline" onClick={()=>setHistory(undefined)}>{tt('close')}</button></section>}
  </article>}
  return <section className="agency-hours__source worker-enrollment timecards" aria-busy={busy||status==='checking'}>
    <p className="notice-box">{source==='internal'?c.internalHint:c.factoryHint}</p>
    {!data?<><p role="status">{tt(status)}</p>{status==='login'&&<Link to="/login">{t('common.login')}</Link>}</>:<>
      <div className="agency-hours__filters">
        <label className="field-label">{c.site}<select value={site} disabled={busy} onChange={e=>{setSite(e.target.value);updateFilters()}}><option value="">{c.selectSite}</option>{[...sites].sort((a,b)=>a[1].localeCompare(b[1],i18n.language)).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="field-label">{t('workflow.timekeeping.period')}<select value={period.kind} disabled={busy} onChange={e=>{setPeriod({...period,kind:e.target.value as AgencyPeriodKind});updateFilters()}}>
         <option value="month">{t('exports.periodMonth')}</option><option value="year">{t('workflow.timekeeping.year')}</option><option value="date">{t('exports.periodDate')}</option><option value="date-range">{t('exports.periodRange')}</option><option value="all">{t('workflow.timekeeping.allPeriods')}</option>
        </select></label>
        {period.kind==='month'&&<label className="field-label">{t('exports.periodMonth')}<input type="month" value={period.month} disabled={busy} onChange={e=>{setPeriod({...period,month:e.target.value});updateFilters()}}/></label>}
        {period.kind==='year'&&<label className="field-label">{t('workflow.timekeeping.year')}<input type="number" min="2000" max="2100" value={period.year} disabled={busy} onChange={e=>{setPeriod({...period,year:e.target.value});updateFilters()}}/></label>}
        {period.kind==='date'&&<label className="field-label">{t('exports.periodDate')}<input type="date" value={period.date} disabled={busy} onChange={e=>{setPeriod({...period,date:e.target.value});updateFilters()}}/></label>}
        {period.kind==='date-range'&&<>
         <label className="field-label">{tt('from')}<input type="date" value={period.from} disabled={busy} onChange={e=>{setPeriod({...period,from:e.target.value});updateFilters()}}/></label>
         <label className="field-label">{tt('to')}<input type="date" value={period.to} disabled={busy} onChange={e=>{setPeriod({...period,to:e.target.value});updateFilters()}}/></label>
        </>}
        {source==='internal'&&<>
         <label className="field-label">{t('workflow.timekeeping.search')}<input type="search" value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);updateFilters()}}/></label>
         <label className="field-label">{tt('workerRef')}<select value={worker} disabled={busy||!workers.length} onChange={e=>{updateFilters();setWorker(e.target.value)}}><option value="">{c.selectWorker}</option>{workers.map(group=><option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        </>}
      </div>
      {source==='internal'&&<fieldset className="agency-hours__weekday" disabled={busy}>
       <legend>{c.weekdays}</legend>
       <div className="form-actions">
        <button className="button button--outline" type="button" disabled={days.length===weekdays.length} onClick={()=>{setDays(weekdays);updateFilters()}}>{c.allDays}</button>
        <button className="button button--outline" type="button" disabled={!days.length} onClick={()=>{setDays([]);updateFilters()}}>{c.noDays}</button>
       </div>
       <div className="agency-hours__days">
        {weekdays.map(day=><label key={day}><input type="checkbox" checked={days.includes(day)} onChange={()=>{setDays(old=>old.includes(day)?old.filter(d=>d!==day):[...old,day]);updateFilters()}}/>{dayName.format(new Date(Date.UTC(2024,0,7+day,12)))}</label>)}
       </div>
      </fieldset>}
      <button type="button" className="button button--outline" disabled={busy} onClick={()=>{setSite('');setPeriod(agencyPeriodToday());setSearch('');setDays(weekdays);updateFilters()}}>{t('workflow.timekeeping.reset')}</button>
      {!periodValid&&<p role="alert">{c.invalidRange}</p>}
      {source==='internal'&&<>
        <div className="agency-hours__heading"><h2>{t('workflow.timekeeping.workers')}</h2><strong>{tt('counted')}: {minutesLabel(matchingWorkers.reduce((sum,row)=>sum+row.paidMinutes,0))}</strong></div>
        {!matchingWorkers.length&&<p>{c.emptyMatch}</p>}
        <ul className="agency-hours__workers">
          {matchingWorkers.map(group=><li key={group.id} className="notice-box"><strong>{group.name}</strong>
           <span>{c.shiftCount}: {group.rows.length}</span><span>{tt('counted')}: <strong>{minutesLabel(group.paidMinutes)}</strong></span>
           <button type="button" className="button button--outline" disabled={busy} onClick={()=>{setDetail(group.id);setHistory(undefined)}}>{tt('open')}</button>
          </li>)}
        </ul>
        {detailGroup&&<AgencyBookDrawer title={detailGroup.name} closeLabel={tt('close')} busy={busy} onClose={()=>{setDetail(undefined);setHistory(undefined)}}>
          <p>{tt('counted')}: <strong>{minutesLabel(detailGroup.paidMinutes)}</strong></p>
          <div className="agency-hours__rows">{detailGroup.rows.map(shiftRow)}</div>
          {notice&&<p role="alert">{tt(notice)}</p>}
        </AgencyBookDrawer>}
        {!site&&workers.length>0&&<p>{c.siteRequired}</p>}
        {site&&!archiveScope&&internal?.shifts.some(s=>s.worksiteId===site&&s.state==='recorded')&&<p>{c.archiveFilters}</p>}
        {canArchive&&archiveBounds&&<form className="notice-box auth-form" onSubmit={e=>{e.preventDefault();void act(null)}}>
          <h3>{tt('archiveTitle')}</h3><p>{tt('sealHint')}</p><p>{archiveBounds.from} - {archiveBounds.to}</p>
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
      {snapshot&&<SnapshotDialog key={snapshot.source+snapshot.worksiteId+snapshot.dateFrom+snapshot.dateTo} snapshot={snapshot} c={c} onClose={()=>setSnapshot(undefined)}/>}
    </>}
    {notice&&<p role={notice==='archivedNotice'?'status':'alert'}>{tt(notice)}</p>}
    <button type="button" className="button button--outline" disabled={busy||status==='checking'} onClick={()=>{setNotice('');setSnapshot(undefined);setHistory(undefined);setRevision(n=>n+1)}}>{tt('refresh')}</button>
  </section>;
}

function SnapshotDialog({snapshot,c,onClose}:{snapshot:AgencyTimecardSnapshot;c:Copy;onClose:()=>void}){
  const {t,i18n}=useTranslation(),tt=(k:string)=>t('timecards.'+k);
  const saving=useRef(false);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[worker,setWorker]=useState('');
  const workerText=(r:AgencyTimecardSnapshot['rows'][number])=>workerLabelText(r.workerLabel,t('memberNames.historicalMissing'),t('memberNames.reference'));
  const distinct=new Map<string,string>();
  for(const row of snapshot.rows){
    if(uuid(row.membershipId)&&(!distinct.has(row.membershipId)||row.workerLabel?.name))
      distinct.set(row.membershipId,workerText(row));
  }
  const labelCounts=new Map<string,number>();
  for(const name of distinct.values())labelCounts.set(name,(labelCounts.get(name)??0)+1);
  const workerOptions=[...distinct].sort((a,b)=>a[1].localeCompare(b[1],i18n.language)||a[0].localeCompare(b[0]));
  const rows=worker?snapshot.rows.filter(row=>row.membershipId===worker):snapshot.rows;
  const paidMinutes=worker?rows.reduce((sum,row)=>sum+row.data.paidMinutes,0):snapshot.paidMinutes;
  async function download(){
    if(saving.current)return;saving.current=true;setBusy(true);setFailed(false);
    try{const {downloadAgencyTimecardWorkbook}=await import('./timecard-xlsx');
      await downloadAgencyTimecardWorkbook(snapshot,{source:c.source,site:c.site,factory:c.factoryLabel,worker:tt('workerRef'),date:tt('date'),start:tt('start'),end:tt('end'),gross:c.gross,break:c.break,paid:c.paid,comment:tt('comment'),total:c.total,worksheet:c.workbook,missingName:t('memberNames.historicalMissing'),reference:t('memberNames.reference'),internal:c.internal,factorySource:c.factory,timeZone:c.timeZone,scope:c.exportScope,workerExtract:c.workerExtract,breakState:t('workflow.breakReport.inputLabel'),breakUnreported:t('workflow.breakReport.notReported'),breakNotTaken:t('breaks.notTaken'),breakPaid:t('workflow.breakReport.paidChoice'),breakUnpaid:t('workflow.breakReport.unpaidChoice')},worker||undefined);
    }catch{setFailed(true)}finally{saving.current=false;setBusy(false)}
  }
  const title=snapshot.source==='connected-factory'?snapshot.factoryName+' / '+snapshot.worksiteName:snapshot.worksiteName;
  return <AgencyBookDrawer title={title} closeLabel={tt('close')} busy={busy} onClose={onClose}>
    <p>{snapshot.dateFrom} – {snapshot.dateTo} · {snapshot.timeZone}</p>
    <label className="field-label">{c.exportScope}<select value={worker} disabled={busy} onChange={e=>{setWorker(e.target.value);setFailed(false)}}>
      <option value="">{c.fullDocument}</option>{workerOptions.map(([id,name])=><option key={id} value={id}>{name}{(labelCounts.get(name)??0)>1?' · '+id.slice(0,8):''}</option>)}
    </select></label>
    {worker&&<p className="muted-copy">{c.extractNotice}</p>}
    <p>{tt('counted')}: <strong>{minutesLabel(paidMinutes)}</strong></p>
    <div className="agency-hours__rows">
      {rows.map(row=><p key={row.id}>{workerText(row)} · {row.data.localDate} · {row.data.startTime}–{row.data.endTime} · <strong>{minutesLabel(row.data.paidMinutes)}</strong></p>)}
    </div>
    <div className="timecards-actions">
      <button type="button" className="button button--primary" disabled={busy} onClick={()=>void download()}>{busy?c.exporting:c.download}</button>
    </div>
    {failed&&<p role="alert">{c.exportError}</p>}
  </AgencyBookDrawer>;
}

