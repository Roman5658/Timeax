import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {factoryCall,parseSetupContext} from './factory-enrollment';
import {factoryHoursCall,parseFactoryHours} from './factory-timecards';
import {cents,payslipsCall,parsePayslips,type PayContext} from './payslips';
import {MAX_RATE_BATCH,payrollRateRoster,rateSelection,sameRateSelection,storeRateSelection,type BatchOutcome} from './payroll-simple';

const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function roster(c:PayContext,signal?:AbortSignal){
 const setup=parseSetupContext(await factoryCall('context',undefined,signal));
 if(!setup.memberships.some(m=>m.id===c.membershipId&&m.organizationId===c.organizationId&&m.kind==='agency'&&m.role==='agency_admin'))
  throw Error('denied');
 let connected;let connectedUnavailable=false;
 if(setup.connections.some(r=>r.agencyId===c.organizationId&&r.state==='active')){
  try{
   connected=parseFactoryHours(await factoryHoursCall(c.organizationId,'context',undefined,signal),c.organizationId);
   if(connected.role!=='agency_admin'||connected.membershipId!==c.membershipId)throw Error('denied');
  }catch{connected=undefined;connectedUnavailable=true}
 }
 return {sites:payrollRateRoster(c.organizationId,c.membershipId,c.workers,setup,connected),connectedUnavailable};
}
export function PayrollRatesPanel({context:c,busy,label,onRatesChanged}:{context:PayContext;busy:boolean;label:(id:string)=>string;onRatesChanged?:(context:PayContext)=>void}){
 const {t}=useTranslation(),tx=(s:string,args?:Record<string,unknown>)=>t('canonicalPayslips.'+s,args??{});
 const [audience,Audience]=useState<'selected'|'production'>('selected'),[site,Site]=useState(''),[selected,Selected]=useState<string[]>([]);
 const [rate,Rate]=useState(''),[date,DateInput]=useState(()=>localDay().slice(0,7)+'-01'),[search,Search]=useState('');
 const [plants,Plants]=useState<Awaited<ReturnType<typeof roster>>>(),[result,Result]=useState<BatchOutcome[]>([]);
 const [pending,Pending]=useState(false),[error,ErrorKey]=useState(''),[viewRates,ViewRates]=useState(c.rates);
 const running=useRef(false), org=c.organizationId;
 useEffect(()=>{
  const stop=new AbortController();
  void roster(c,stop.signal).then(v=>{if(!stop.signal.aborted)Plants(v)}).catch(()=>{});
  return()=>stop.abort()
 },[c]);
 const all=c.workers.map(w=>w.id);
 const production=plants?.sites.find(v=>v.id===site);
 const choices=audience==='production'?production?.workerIds??[]:selected;
 const addresses=rateSelection(choices,all);
 const amount=cents(rate);
 const valid=addresses!==undefined&&amount!==undefined&&amount>0&&amount<=1000000&&!!date;
 const blocked=busy||pending;
 const toggle=(id:string)=>Selected(s=>s.includes(id)?s.filter(x=>x!==id):s.length<MAX_RATE_BATCH?[...s,id]:s);
 async function save(){
  if(running.current||busy||!valid||!addresses||amount===undefined)return;
  running.current=true;Pending(true);Result([]);ErrorKey('');
  try{
   const fresh=parsePayslips(await payslipsCall(org,'context'),org);
   if(fresh.role!=='agency_admin'||fresh.membershipId!==c.membershipId)throw Error('denied');
   const active=fresh.workers.map(w=>w.id);
   const target=rateSelection(addresses,active);
   if(!target)throw Error('changed');
   if(audience==='production'){
    const freshRoster=await roster(fresh);
    Plants(freshRoster);
    const group=freshRoster.sites.find(x=>x.id===site);
    if(!group||!sameRateSelection(group.workerIds,target))throw Error('changed');
   }
   const outcomes=await storeRateSelection(target,{cents:amount,effectiveOn:date,basis:'gross'},fresh.rates,
    value=>payslipsCall(org,'rate',{...value,operationId:crypto.randomUUID()}));
   Result(outcomes);
   // Refresh the list without clearing outcomes. If it fails, the per-person responses above still stand.
   try{
    const updated=parsePayslips(await payslipsCall(org,'context'),org);
    if(updated.role==='agency_admin'&&updated.membershipId===c.membershipId){ViewRates(updated.rates);onRatesChanged?.(updated)}
   }catch{}
  }catch(e){ErrorKey(e instanceof Error&&e.message==='changed'?'rosterChanged':'rateNotVerified')}
  finally{running.current=false;Pending(false)}
 }
 const shown=all.map(id=>({id,label:label(id)})).sort((a,b)=>a.label.localeCompare(b.label)).filter(x=>x.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const ok=result.filter(x=>x.status==='saved'||x.status==='already').length;
 return <section className="notice-box payroll-rate-panel" aria-busy={pending}>
  <h3>{tx('setRates')}</h3><p>{tx('simpleRateHint')}</p>
  <form className="auth-form" onSubmit={e=>{e.preventDefault();void save()}}>
   <label className="field-label">{tx('rateScope')}<select value={audience} disabled={blocked} onChange={e=>{Audience(e.target.value==='production'?'production':'selected');Result([]);ErrorKey('')}}>
    <option value="selected">{tx('selectedPeople')}</option><option value="production">{tx('wholeProduction')}</option>
   </select></label>
   {audience==='production'?<>
    <label className="field-label">{tx('chooseProduction')}<select value={site} required disabled={blocked} onChange={e=>{Site(e.target.value);Result([]);ErrorKey('')}}>
     <option value="">{tx('choose')}</option>{plants?.sites.map(v=><option value={v.id} key={v.id}>{v.name} ({v.workerIds.length})</option>)}
    </select></label>
    {(!plants||plants.connectedUnavailable)&&<p>{tx('productionMissing')}</p>}
    {production&&<details><summary>{tx('selectedCount',{count:production.workerIds.length})}</summary><ul>{production.workerIds.map(id=><li key={id}>{label(id)}</li>)}</ul></details>}
   </>:<fieldset className="payroll-rate-roster" disabled={blocked}>
    <legend>{tx('selectedCount',{count:selected.length})}</legend>
    <label className="field-label">{tx('searchPeople')}<input value={search} onChange={e=>Search(e.target.value)}/></label>
    <div className="payroll-rate-choices">{shown.map(v=><label className="timecards-check" key={v.id}>
     <input type="checkbox" checked={selected.includes(v.id)} disabled={!selected.includes(v.id)&&selected.length>=MAX_RATE_BATCH} onChange={()=>toggle(v.id)}/>{v.label}
    </label>)}</div>
    {!shown.length&&<p>{tx('noRateWorkers')}</p>}
    <button type="button" className="button button--outline" disabled={!selected.length} onClick={()=>Selected([])}>{tx('clearPeople')}</button>
   </fieldset>}
   {choices.length>MAX_RATE_BATCH&&<p role="alert">{tx('batchLimit',{count:MAX_RATE_BATCH})}</p>}
   <label className="field-label">{tx('grossRatePerHour')}<input inputMode="decimal" required maxLength={10} value={rate} disabled={blocked} onChange={e=>Rate(e.target.value)}/></label>
   <label className="field-label">{tx('effective')}<input type="date" required value={date} disabled={blocked} onChange={e=>DateInput(e.target.value)}/></label>
   <p className="muted-copy">{tx('effectivePeriodHint')}</p><button className="button button--primary button--full" disabled={blocked||!valid}>{tx('saveRate')}</button>
  </form>
  {error&&<p role="alert">{tx(error)}</p>}
  {!!result.length&&<div role="status"><p>{tx('batchReport',{ok,total:result.length})}</p>
   {result.some(x=>x.status!=='saved'&&x.status!=='already')&&<ul>{result.filter(x=>x.status!=='saved'&&x.status!=='already').map(x=><li key={x.id}>{label(x.id)}: {tx('rateResult.'+x.status)}</li>)}</ul>}
  </div>}
  {viewRates.some(r=>r.member_id)&&<details><summary>{tx('savedRateList')}</summary><ul>{viewRates.filter(r=>r.member_id).map(r=><li key={r.id}>{label(r.member_id!)}: {(r.cents/100).toFixed(2)} PLN / h ({tx(r.basis)}), {r.effective_on}</li>)}</ul></details>}
 </section>
}
