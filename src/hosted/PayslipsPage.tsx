import {useMemberNames} from './MemberNames';
import {workerLabelText} from './member-label';
import {useEffect,useMemo,useRef,useState} from 'react';import {Link,useLocation} from 'react-router-dom';import {useTranslation} from 'react-i18next';
import {RegistrationFrame} from '../components/PublicExperience';import {PrivateAccess} from './PrivateAccess';import {StagingSessionPanel} from '../modules/auth/pages/StagingSessionPanel';import {isWorkerLocal} from './worker-enrollment';import {minutesLabel} from './timecards';import {calculatePayroll} from '../modules/payroll/domain/payroll';
import {payslipsCall,parsePayslips,parsePublication,cents,type PayContext,type PayPublication,type PaySource} from './payslips';import {canonicalPayslipHtml} from './payslip-document';
import {PayrollRatesPanel} from './PayrollRatesPanel';
import {PayslipDraftEditor,type PayslipAction} from './PayslipDraftEditor';
import {PayslipAmounts} from './PayslipAmounts';
import {SimplePayslipSend} from './SimplePayslipSend';
import '../styles/timecards.css';import '../styles/worker-enrollment.css';import '../styles/payslips.css';
const money=(c:number)=>(c/100).toFixed(2)+' PLN',today=()=>new Date().toISOString().slice(0,10);
function Source({s}:{s:PaySource}){const {t}=useTranslation(),tx=(k:string)=>t('canonicalPayslips.'+k);return <div className="pay-source"><strong>{s.agencyName} / {s.siteName}</strong><p>{tx(s.kind)}  /  {s.dateFrom}  -  {s.dateTo}</p><p>{tx('worker')}: {workerLabelText(s.workerLabel,t('memberNames.historicalMissing'),t('memberNames.reference'))}</p><strong>{tx('hours')}: {minutesLabel(s.paidMinutes)}</strong><details><summary>{tx('sourceRows')}</summary>{s.rows.map(r=><p key={r.id}>{r.data.localDate}: {r.data.startTime}-{r.data.endTime}, {minutesLabel(r.data.paidMinutes)}</p>)}<p>Europe/Warsaw</p></details></div>}
function Preliminary(){const {t}=useTranslation(),tx=(k:string)=>t('canonicalPayslips.'+k);const [hours,H]=useState(''),[rate,R]=useState(''),[basis,B]=useState('gross'),[add,A]=useState('0');const rateC=cents(rate),addC=cents(add),v=hours.trim()&&rateC!==undefined&&addC!==undefined?calculatePayroll({dayHours:Number(hours.replace(',','.')),nightHours:0,dayRate:rateC/100,nightRate:0,additions:addC/100,deductions:0,note:''}):undefined;
return <details className="notice-box"><summary>{tx('preliminary')}</summary><p>{tx('preliminaryHint')}</p><label className="field-label">{tx('estimatedHours')}<input inputMode="decimal" value={hours} onChange={e=>H(e.target.value)}/></label><label className="field-label">{tx('rate')}<input inputMode="decimal" value={rate} onChange={e=>R(e.target.value)}/></label><label className="field-label">{tx('basis')}<select value={basis} onChange={e=>B(e.target.value)}><option value="gross">{tx('gross')}</option><option value="net">{tx('net')}</option></select></label><label className="field-label">{tx('additions')}<input inputMode="decimal" value={add} onChange={e=>A(e.target.value)}/></label>{v&&<p role="status">{tx('estimate')}: {money(Math.round(v.gross*100))} {tx(basis)}</p>}</details>}
function AdvancedRates({c,busy,act,label}:{c:PayContext;busy:boolean;act:PayslipAction;label:(id:string)=>string}){
 const {t}=useTranslation(),tx=(k:string)=>t('canonicalPayslips.'+k);const [name,N]=useState(''),[member,W]=useState(''),[group,G]=useState(''),[date,E]=useState(today),[target,T]=useState('individual'),[rate,R]=useState(''),[basis,B]=useState('gross');
 const workers=<><option value="">{tx('choose')}</option>{c.workers.map(w=><option key={w.id} value={w.id}>{label(w.id)}</option>)}</>,groups=<><option value="">{tx('choose')}</option>{c.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</>;
 return <details className="notice-box"><summary>{tx('advancedRates')}</summary><p>{tx('ratesHint')}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();void act('group',{name:name.trim()})}}><label className="field-label">{tx('groupName')}<input value={name} minLength={2} maxLength={80} required disabled={busy} onChange={e=>N(e.target.value)}/></label><button className="button button--outline" disabled={busy||name.trim().length<2}>{tx('addGroup')}</button></form>
 <label className="field-label">{tx('effective')}<input type="date" value={date} required disabled={busy} onInput={e=>E(e.currentTarget.value)} onChange={e=>E(e.target.value)}/></label><label className="field-label">{tx('worker')}<select value={member} disabled={busy} onChange={e=>W(e.target.value)}>{workers}</select></label><label className="field-label">{tx('group')}<select value={group} disabled={busy} onChange={e=>G(e.target.value)}>{groups}</select></label><button className="button button--outline" disabled={busy||!member||!group||!date} onClick={()=>void act('group-member',{memberId:member,groupId:group,effectiveOn:date})}>{tx('joinGroup')}</button>
 <form className="auth-form" onSubmit={e=>{e.preventDefault();void act('rate',{groupId:target==='group'?group:null,memberId:target==='individual'?member:null,effectiveOn:date,basis,cents:cents(rate)})}}>
 <label className="field-label">{tx('rateScope')}<select value={target} disabled={busy} onChange={e=>T(e.target.value)}><option value="individual">{tx('individual')}</option><option value="group">{tx('group')}</option></select></label><label className="field-label">{tx('basis')}<select value={basis} disabled={busy} onChange={e=>B(e.target.value)}><option value="gross">{tx('gross')}</option><option value="net">{tx('net')}</option></select></label><label className="field-label">{tx('rate')}<input inputMode="decimal" required value={rate} disabled={busy} onChange={e=>R(e.target.value)}/></label><button className="button button--outline button--full" disabled={busy||!date||cents(rate)===undefined||cents(rate)!>1000000||!(target==='group'?group:member)}>{tx('saveRate')}</button></form>
 {c.rates.map(r=><p key={r.id}>{r.effective_on}: {money(r.cents)} / h {tx(r.basis)}  /  {r.group_id?c.groups.find(g=>g.id===r.group_id)?.name:label(r.member_id??'')}</p>)}
 </details>
}
export function PayslipsPanel({organizationId,revision=0,showTitle=true,onPublicationOpened}:{organizationId:string;revision?:number;showTitle?:boolean;onPublicationOpened?:(id:string)=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t('canonicalPayslips.'+k),tt=(k:string)=>t('timecards.'+k);const [c,C]=useState<PayContext>(),[status,S]=useState('checking'),[refresh,R]=useState(0),[busy,B]=useState(false),[notice,N]=useState(''),[document,D]=useState<PayPublication>();const pending=useRef(false);
 const {hash}=useLocation(),opened=useRef(new Set<string>()),deepLink=useRef(''),advanced=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const abort=new AbortController();C(undefined);S('checking');D(undefined);void payslipsCall(organizationId,'context',undefined,abort.signal).then(v=>parsePayslips(v,organizationId)).then(v=>{if(!abort.signal.aborted){C(v);S('ready')}}).catch(e=>{if(!abort.signal.aborted)S(['login','denied'].includes(e.message)?e.message:'unavailable')});return()=>abort.abort()},[organizationId,revision,refresh]);
 const {context:names,label:memberLabel}=useMemberNames(organizationId,revision+refresh);
 const label=(id:string)=>names?.workers.some(w=>w.membershipId===id)?memberLabel(id):id.slice(0,8);
 const blob=useMemo(()=>document?URL.createObjectURL(new Blob([canonicalPayslipHtml(document)],{type:'text/html;charset=utf-8'})):undefined,[document]);useEffect(()=>()=>{if(blob)URL.revokeObjectURL(blob)},[blob]);
 async function act(action:string,body?:Record<string,unknown>){
  if(pending.current)return;
  const readId=action.startsWith('read/')?action.slice(5):undefined;
  const scope=c?.organizationId===organizationId?c:undefined;
  if(readId&&(!scope||!scope.published.some(p=>p.id===readId)))return;
  pending.current=true;B(true);N('');
  try{
   const v=await payslipsCall(organizationId,action,body?{...body,operationId:crypto.randomUUID()}:undefined);
   if(readId){
    const receipt=parsePublication(v,organizationId);
    if(receipt.id!==readId||scope?.role==='worker'&&receipt.document.source.workerKey!==scope.membershipId)throw Error('unavailable');
    D(receipt);
    if(scope?.role==='worker'&&onPublicationOpened){
     const key=scope.organizationId+':'+scope.membershipId+':'+receipt.id;
     if(!opened.current.has(key)){opened.current.add(key);onPublicationOpened(receipt.id)}
    }
   }else{N('saved');R(n=>n+1)}
  }catch(e){N(['login','denied','conflict','invalid'].includes((e as Error).message)?(e as Error).message:'uncertain');if(!readId)R(n=>n+1)}
  finally{pending.current=false;B(false)}
 }
 useEffect(()=>{
  if(!hash){deepLink.current='';return}
  const target=hash.match(/^#payslip-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/)?.[1];
  if(!target||busy||!c||c.organizationId!==organizationId||c.role!=='worker'||!c.published.some(p=>p.id===target))return;
  const key=organizationId+':'+c.membershipId+':'+target;
  if(deepLink.current===key)return;
  deepLink.current=key;void act('read/'+target);
  // Scope and the exact route/hash decide whether an authorized receipt exists.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[hash,c,organizationId,busy]);
 useEffect(()=>{
  if(!document||hash!=='#payslip-'+document.id)return;
  window.document.getElementById('payslip-'+document.id)?.scrollIntoView({block:'nearest'});
 },[hash,document]);
 return <section className="worker-enrollment timecards payslips" aria-busy={busy}>{showTitle&&<h2>{tx('title')}</h2>}{!c||c.organizationId!==organizationId?<p role="status">{tt(status)}</p>:<>
 {c.role==='agency_admin'&&<SimplePayslipSend key={c.organizationId+':'+c.membershipId} context={c} busy={busy} label={label} onBusy={value=>{pending.current=value;B(value)}} onContext={C} onOpenRates={()=>{
   if(advanced.current){advanced.current.open=true;advanced.current.querySelector('.payroll-rate-panel')?.scrollIntoView({block:'start'})}
 }}/>}
 <details><summary>{tx('aboutPayslips')}</summary><p>{tx(c.role)}</p><p>{tx('scopeHint')}</p></details>
 {c.role==='agency_admin'&&c.settings&&<details ref={advanced} className="notice-box"><summary>{tx('simple.advanced')}</summary><PayrollRatesPanel key={c.organizationId+':'+c.membershipId} context={c} busy={busy} label={label} onRatesChanged={C}/><section className="notice-box"><h3>{tx('prepareFromTimesheet')}</h3><p>{tx('timecardNext')}</p><Link className="button button--outline button--full" to={'/workspace/'+organizationId+'/timecards'}>{tx('openTimecards')}</Link></section><details className="notice-box"><summary>{tx('settings')}</summary><label className="timecards-check"><input type="checkbox" checked={c.settings.enabled} disabled={busy} onChange={e=>void act('settings',{enabled:e.target.checked,autoDraft:c.settings!.auto_draft,revision:c.settings!.revision})}/>{tx('enabled')}</label><label className="timecards-check"><input type="checkbox" checked={c.settings.auto_draft} disabled={busy} onChange={e=>void act('settings',{enabled:c.settings!.enabled,autoDraft:e.target.checked,revision:c.settings!.revision})}/>{tx('autoDraft')}</label><p>{tx('settingsHint')}</p><AdvancedRates c={c} busy={busy} act={act} label={label}/></details><h3>{tx('sources')}</h3>{!c.sources.length&&<p>{tx('noSources')}</p>}{c.sources.map(s=><article className="notice-box" key={s.kind+s.sourceId+s.workerKey}><Source s={s}/><button className="button button--outline button--full" disabled={busy||!c.settings?.enabled||c.drafts.some(d=>d.source_id===s.sourceId&&d.member_id===s.workerKey&&d.kind===s.kind)||c.published.some(d=>d.document.source.sourceId===s.sourceId&&d.document.source.workerKey===s.workerKey&&d.document.source.kind===s.kind)} onClick={()=>void act('create',{kind:s.kind,sourceId:s.sourceId,memberId:s.workerKey})}>{tx('create')}</button></article>)}</details>}
 {c.role!=='worker'&&<details className="notice-box" open={c.role==='accountant'?true:undefined}><summary>{tx('drafts')}</summary>{!c.drafts.length&&<p>{tx('noDrafts')}</p>}{c.drafts.map(d=><PayslipDraftEditor key={d.id+':'+d.revision} draft={d} context={c} busy={busy} act={act} label={id=>c.accountants.findIndex(a=>a.id===id)>=0?t('canonicalPayslips.accountantNumber',{number:c.accountants.findIndex(a=>a.id===id)+1}):label(id)}><Source s={d.source}/></PayslipDraftEditor>)}</details>}
 <h3>{tx('published')}</h3>{!c.published.length&&<p>{tx('nonePublished')}</p>}{c.published.map(p=><article key={p.id} className="notice-box"><Source s={p.document.source}/><p>{tx('issued')}: {new Date(p.issued_at).toLocaleString()}</p><PayslipAmounts value={p.document.calculation}/><button className="button button--outline" disabled={busy} onClick={()=>void act('read/'+p.id)}>{tx('open')}</button></article>)}
 {document&&document.document.source.agencyId===organizationId&&<section id={'payslip-'+document.id} className="notice-box"><h3>{tx('document')}</h3><Source s={document.document.source}/><PayslipAmounts value={document.document.calculation}/><p>{tx('immutable')}</p><a href={blob} download={'Timeax-payslip-'+document.id+'.html'} className="button button--outline button--full">{tx('download')}</a></section>}
 {c.role==='worker'&&<Preliminary/>}</>}{notice&&<p role={notice==='saved'?'status':'alert'}>{notice==='saved'?tx('saved'):tt(notice)}</p>}<button className="button button--outline button--full" disabled={busy||status==='checking'} onClick={()=>R(n=>n+1)}>{tx('refresh')}</button></section>
}
export function PayslipsPage(){const {t}=useTranslation(),loc=useLocation(),org=loc.pathname.match(/^\/workspace\/([0-9a-f-]+)\/payslips$/)?.[1];const [revision,R]=useState(0),[access,A]=useState(0);return <RegistrationFrame title={t('canonicalPayslips.title')} lead={t('canonicalPayslips.lead')}>{!isWorkerLocal()&&<><PrivateAccess onOpened={()=>{A(n=>n+1);R(n=>n+1)}}/><StagingSessionPanel key={access} guided purpose="existing" audience="workspace" onChanged={()=>R(n=>n+1)}/></>}{org&&<><PayslipsPanel organizationId={org} revision={revision} showTitle={false}/><Link to={'/workspace/'+org}>{t('timecards.back')}</Link></>}</RegistrationFrame>}
