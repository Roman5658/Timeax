import {useEffect,useMemo,useState,useRef,type ReactNode} from 'react';
import {ClipboardList,FileSpreadsheet} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useMemberNames} from './MemberNames';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {agencyPeriodToday,agencyPeriodBounds,agencyPeriodOverlaps,agencyShiftGroups,weekdays,type AgencyPeriodKind} from './agency-hours-scope';
import {TimecardReportDrawer} from './TimecardReportDrawer';
import {agencyTimecardsCopy} from './agency-timecards-copy';
import {timecardCall,parseTimecards,parseSnapshot,minutesLabel,type TimecardContext,type ShiftData,type TimecardShift} from './timecards';
import {factoryHoursCall,parseFactoryHours,parseFactorySnapshot,type FactoryHoursContext} from './factory-timecards';
import {liveTimekeepingReport,type AgencyTimecardSnapshot,type TimecardReport} from './timecard-document';
import {timecardWorkbookCopy} from './timecard-workbook-copy';
import {teamCall,type TeamContext} from './team-workflow';
import {scopedReportedAbsences} from './live-timecard-absences';
import '../styles/timecards.css';
import '../styles/agency-hours.css';

type Source='internal'|'factory';
type Copy=ReturnType<typeof agencyTimecardsCopy>;
type DocumentRow={id:string;name:string;worksiteId:string;dateFrom:string;dateTo:string;paidMinutes:number;factoryName?:string;factoryId?:string};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
export function AgencyTimecardsPanel({organizationId,internalEnabled,factoryEnabled,initialSource='internal',reviewPanel}:{
  organizationId:string; internalEnabled:boolean; factoryEnabled:boolean; initialSource?:Source;reviewPanel?:ReactNode;
}){
  const {t,i18n}=useTranslation(),c=agencyTimecardsCopy(i18n.language);
  const [selected,setSelected]=useState<Source>(initialSource);
  useEffect(()=>setSelected(initialSource),[initialSource]);
  const enabled={internal:internalEnabled,factory:factoryEnabled};
  const source=enabled[selected]?selected:enabled.internal?'internal':'factory';
  if(!internalEnabled&&!factoryEnabled)return <><p role="status">{t('timecards.unavailable')}</p>{reviewPanel}</>;
  return <section className="agency-hours">
    <div className="agency-hours__sources" role="group" aria-label={c.source}>
      <button type="button" className={'button '+(source==='internal'?'button--primary':'button--outline')} aria-pressed={source==='internal'} disabled={!internalEnabled} onClick={()=>setSelected('internal')}>{c.internal}</button>
      <button type="button" className={'button '+(source==='factory'?'button--primary':'button--outline')} aria-pressed={source==='factory'} disabled={!factoryEnabled} onClick={()=>setSelected('factory')}>{c.factory}</button>
    </div>
    <AgencySource key={organizationId+':'+source} organizationId={organizationId} source={source} c={c} reviewPanel={reviewPanel}/>
  </section>;
}

function AgencySource({organizationId,source,c,reviewPanel}:{organizationId:string;source:Source;c:Copy;reviewPanel?:ReactNode}){
  const {t,i18n}=useTranslation(),tt=(k:string)=>t('timecards.'+k);
  const [team,setTeam]=useState<TeamContext>();
  const [data,setData]=useState<TimecardContext|FactoryHoursContext>(),[status,setStatus]=useState('checking'),[revision,setRevision]=useState(0);
  const [site,setSite]=useState(''),[worker,setWorker]=useState(''),[period,setPeriod]=useState(()=>agencyPeriodToday());
  const [search,setSearch]=useState(''),[days,setDays]=useState<readonly number[]>(weekdays),[detail,setDetail]=useState<string>();
  const dayName=new Intl.DateTimeFormat(i18n.language,{weekday:'long',timeZone:'UTC'});
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[snapshot,setSnapshot]=useState<TimecardReport>(),[excelError,setExcelError]=useState(false),[exporting,setExporting]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const [history,setHistory]=useState<{id:string;revisions:{revision:number;data:ShiftData;reason:string}[]}>();
  const {label,context:names}=useMemberNames(source==='internal'?organizationId:undefined,revision);
  useEffect(()=>{
    const controller=new AbortController();
    setStatus('checking');setData(undefined);
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
  useEffect(()=>{
    if(source!=='internal')return;
    const ctl=new AbortController();
    async function load(){try{const value=await teamCall(organizationId,'context',undefined,ctl.signal);if(!ctl.signal.aborted)setTeam(value)}catch{if(!ctl.signal.aborted)setTeam(undefined)}}
    void load();
    window.addEventListener('timeax-team-changed',load);
    return()=>{ctl.abort();window.removeEventListener('timeax-team-changed',load)};
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
    (factory?.archive??[]).map(row=>({id:row.id,name:row.snapshot.worksiteName,worksiteId:row.worksiteId,dateFrom:row.dateFrom,dateTo:row.dateTo,paidMinutes:row.snapshot.paidMinutes,factoryName:row.snapshot.factoryName,factoryId:row.snapshot.factoryId}));
  const sites=source==='internal'?new Map([...documents.map(d=>[d.worksiteId,d.name] as const),...(internal?.worksites??[]).map(s=>[s.id,s.name] as const)]):new Map([...(factory?.sites??[]).map(s=>[s.id,s.name] as const),...documents.map(d=>[d.worksiteId,d.name] as const)]);
  const filteredDocuments=documents.filter(row=>(!site||row.worksiteId===site)&&agencyPeriodOverlaps(row.dateFrom,row.dateTo,bounds))
    .sort((a,b)=>b.dateTo.localeCompare(a.dateTo)||a.name.localeCompare(b.name,i18n.language));
  const scopedNames=useMemo(()=>new Map(names?.workers.filter(w=>w.organizationId===organizationId).map(w=>[w.membershipId,w])),[names,organizationId]);
  const absences=internal?scopedReportedAbsences(team,{organizationId,membershipId:internal.membershipId,site,worker,bounds,days,search,label,language:i18n.language})?.map(a=>({...a,name:label(a.membershipId)})):undefined;
  const report=internal?liveTimekeepingReport(internal,matchingWorkers,bounds,c.selectSite,id=>{
   const entry=scopedNames.get(id);return entry?{...entry,source:'current'}:undefined;
  },absences):undefined;
  // Don't silently apply screen-only employee/search/weekday filters to the whole site archive.
  const archiveBounds=bounds&&period.kind!=='year'?{from:bounds.from,to:[bounds.to,agencyPeriodToday().date].sort()[0]}:null;
  const archiveScope=!!archiveBounds&&archiveBounds.from<=archiveBounds.to&&days.length===weekdays.length&&!search.trim()&&!worker;
  const archiveSite=site||(internal?.worksites.length===1?internal.worksites[0].id:'');
  const inferredSite=!site&&archiveSite?internal?.worksites.find(w=>w.id===archiveSite):undefined;
  const canArchive=source==='internal'&&archiveScope&&!!archiveSite&&internal?.worksites.some(w=>w.id===archiveSite)===true&&
   workers.some(g=>g.rows.some(row=>row.worksiteId===archiveSite&&row.state==='recorded'&&row.data.localDate<=archiveBounds!.to));

  async function readDocument(id:string,controller:AbortController,expected?:DocumentRow):Promise<AgencyTimecardSnapshot>{
    if(!uuid(id))throw Error('invalid');
    const raw=await (source==='internal'?timecardCall:factoryHoursCall)(organizationId,'read/'+id,undefined,controller.signal);
    const saved=source==='internal'?parseSnapshot(raw,organizationId):parseFactorySnapshot((raw as {snapshot?:unknown})?.snapshot);
    if(saved.organizationId!==organizationId||expected&&(saved.worksiteId!==expected.worksiteId||saved.dateFrom!==expected.dateFrom||
     saved.dateTo!==expected.dateTo||saved.paidMinutes!==expected.paidMinutes||saved.source==='connected-factory'&&saved.factoryId!==expected.factoryId))throw Error('denied');
    return saved;
  }
  async function exportExcel(target:TimecardReport|DocumentRow){
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;
    setExporting(true);setBusy(true);setExcelError(false);
    try{
      const data='rows' in target?target:await readDocument(target.id,controller,target);
      const {downloadAgencyTimecardWorkbook}=await import('./timecard-xlsx');
      if(!controller.signal.aborted)await downloadAgencyTimecardWorkbook(data,timecardWorkbookCopy(t,i18n.resolvedLanguage||i18n.language||'pl'),undefined,controller.signal);
    }catch{if(!controller.signal.aborted)setExcelError(true)}
    finally{if(pending.current===controller)pending.current=null;if(!controller.signal.aborted){setBusy(false);setExporting(false)}}
  }
  async function act(id:string|null){
    if(pending.current)return;
    const controller=new AbortController();
    pending.current=controller;
    setBusy(true);setNotice('');setSnapshot(undefined);
    try{
      let documentId=id;
      if(!documentId){
        if(!confirmed||!canArchive||!archiveBounds)return;
        const result=await timecardCall(organizationId,'archive',{worksiteId:archiveSite,dateFrom:archiveBounds.from,dateTo:archiveBounds.to,confirmed:true},controller.signal) as {id?:unknown};
        if(!uuid(result.id))throw Error('uncertain');
        documentId=result.id;
        if(!controller.signal.aborted){setConfirmed(false);setNotice('archivedNotice');setRevision(n=>n+1)}
      }
      const expected=id?documents.find(d=>d.id===id):undefined;
      if(id&&!expected)throw Error('denied');
      const saved=await readDocument(documentId,controller,expected);
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
  const updateFilters=()=>{setConfirmed(false);setWorker('');setHistory(undefined);setDetail(undefined);setNotice('');setExcelError(false)};
  function shiftRow(row:TimecardShift){return <article className="notice-box timecards-row" key={row.id}>
    <strong>{row.worksiteName}</strong>
    <p>{row.data.localDate} &middot; {row.data.startTime}-{row.data.endTime} &middot; {tt('counted')}: <strong>{minutesLabel(row.data.paidMinutes)}</strong> &middot; {tt(row.state)}</p>
    <p>{tt('break')}: {row.data.breakStatus==='not-reported'?t('workflow.breakReport.notReported'):row.data.breakStatus==='not-taken'?t('breaks.notTaken'):row.data.breakTreatment==='paid'?t('workflow.breakReport.paidChoice'):`${t('workflow.breakReport.unpaidChoice')} · ${minutesLabel(row.data.breakMinutes)}`}</p>{row.data.comment&&<p>{row.data.comment}</p>}
    <button type="button" className="button button--outline" disabled={busy} onClick={()=>void readHistory(row.id)}>{tt('history')}</button>
    {history?.id===row.id&&<section className="notice-box"><h3>{tt('history')}</h3>{history.revisions.map(h=><p key={h.revision}>{tt('version')} {h.revision}: {h.data.localDate} {h.data.startTime}-{h.data.endTime} &middot; {h.reason==='created'?tt('created'):h.reason}</p>)}<button type="button" className="button button--outline" onClick={()=>setHistory(undefined)}>{tt('close')}</button></section>}
  </article>}
  return <section className="agency-hours__source worker-enrollment timecards" aria-busy={busy||status==='checking'}>
    <p className="notice-box">{source==='internal'?c.internalHint:c.factoryHint}</p>
    {!data?<><p role="status">{tt(status)}</p>{status==='login'&&<Link to="/login">{t('common.login')}</Link>}{reviewPanel}</>:<>
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
      <section className="dashboard-panel agency-hour-exports" aria-label={c.excelGroup}>
       <h2>{c.excelGroup}</h2>
       {source==='internal'&&<>
        <div className="form-actions">
         <button type="button" className="button button--primary" disabled={busy||!report} onClick={()=>{if(report){setSnapshot(report);setExcelError(false)}}}><ClipboardList size={17} aria-hidden="true"/>{c.timesheetPreview}</button>
         <button type="button" className="button button--outline" disabled={busy||!report} onClick={()=>{if(report)void exportExcel(report)}}><FileSpreadsheet size={17} aria-hidden="true"/>{exporting?c.exporting:c.exportVisible}</button>
        </div>
        <p>{report?c.liveNotice:c.exportUnavailable}</p>
        {!archiveSite&&workers.length>0&&<p>{c.siteRequired}</p>}
        {site&&!archiveScope&&internal?.shifts.some(s=>s.worksiteId===site&&s.state==='recorded')&&<p>{c.archiveFilters}</p>}
        {canArchive&&archiveBounds&&<form className="notice-box auth-form" onSubmit={e=>{e.preventDefault();void act(null)}}>
          <h3>{tt('archiveTitle')}</h3><p>{tt('sealHint')}</p><p>{inferredSite&&<strong>{inferredSite.name}: </strong>}{archiveBounds.from} - {archiveBounds.to}</p>
          <label className="timecards-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{tt('sealConfirm')}</label>
          <button className="button button--outline" disabled={busy||!confirmed}>{tt('archiveAction')}</button>
        </form>}
       </>}
       <p className="muted-copy">{c.shareNotice}</p>
       {excelError&&<p role="alert">{c.exportError}</p>}
      </section>
      {reviewPanel}
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

      </>}
      <div className="agency-hours__heading"><h2>{source==='internal'?c.archive:c.received}</h2></div>
      {!filteredDocuments.length&&<p>{documents.length?c.emptyMatch:source==='internal'?tt('noArchive'):c.emptyReceived}</p>}
      <div className="agency-hours__rows">{filteredDocuments.map(record=><article className="notice-box timecards-row" key={record.id}>
        <strong>{record.factoryName&&record.factoryName+' · '}{record.name}</strong>
        <p>{record.dateFrom} – {record.dateTo} · {tt('counted')}: <strong>{minutesLabel(record.paidMinutes)}</strong></p>
        <div className="form-actions">
         <button type="button" className="button button--outline" disabled={busy} onClick={()=>void act(record.id)}>{c.openTimecard}</button>
         <button type="button" className="button button--outline" disabled={busy} onClick={()=>void exportExcel(record)}><FileSpreadsheet size={17} aria-hidden="true"/>{c.exportDocument}</button>
        </div>
      </article>)}</div>
      {snapshot&&<TimecardReportDrawer key={snapshot.source+snapshot.worksiteId+snapshot.dateFrom+snapshot.dateTo} snapshot={snapshot} onClose={()=>setSnapshot(undefined)}/>}
    </>}
    {notice&&<p role={notice==='archivedNotice'?'status':'alert'}>{tt(notice)}</p>}
    <button type="button" className="button button--outline" disabled={busy||status==='checking'} onClick={()=>{setNotice('');setSnapshot(undefined);setHistory(undefined);setRevision(n=>n+1)}}>{tt('refresh')}</button>
  </section>;
}
