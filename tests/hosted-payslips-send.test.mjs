import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {blankSimplePay,buildSimpleIssuePlan,existingSimpleValues,issueSimplePlans,SIMPLE_PAY_NOTE,simplePayValues,simpleSavedGrossRate,simpleSourceGroups} from '../src/hosted/payslips-send.ts';

const id=x=>'17000000-0000-4000-8000-'+String(x).padStart(12,'0');
const org=id(1),agency=id(2),west=id(3),east=id(4),one=id(11),two=id(12),three=id(13),group=id(14);
const from='2026-11-01',to='2026-11-30';
const source=(workerKey,index,location=west,sourceId=id(9))=>({
 agencyId:org,kind:'internal',sourceId,siteId:location,siteName:location===west?'West':'East',dateFrom:from,dateTo:to,workerKey,paidMinutes:6000,
 rows:Array.from({length:10},(_,i)=>({id:id(index+i),membershipId:workerKey,revision:1,data:{localDate:'2026-11-'+String(i+1).padStart(2,'0'),paidMinutes:600,startAt:'a',endAt:'b'}}))
});
const a=source(one,100),b=source(two,200),c=source(three,300),foreign=source(one,400,east,id(10));
const rate=(member,cents,serial,basis='gross',effective_on=from,group_id=null)=>({id:id(serial),member_id:member,group_id,effective_on,basis,cents});
const context=(overrides={})=>({role:'agency_admin',organizationId:org,membershipId:agency,settings:{enabled:true},sources:[a,b,c,foreign],
 drafts:[],published:[],rates:[rate(one,3000,501),rate(two,2900,502),rate(null,3500,503,'gross','2026-11-04',group),rate(three,3700,504,'net')],
 groupAssignments:[{member_id:one,group_id:group,effective_on:from}],...overrides});
const deductions={deductions:[{name:'PIT',amount:'100'},{name:'Other actual adjustment',amount:'200'}]};
const chosen=(c)=>simpleSourceGroups(c).find(g=>g.siteName==='West');
const payPlan=(c=context())=>buildSimpleIssuePlan(chosen(c),c,new Map([[one,deductions],[two,blankSimplePay()]]));
const makeDraft=(target,suffix=1)=>({id:id(600+suffix),agency_id:org,member_id:target.source.workerKey,kind:target.source.kind,source_id:target.source.sourceId,
 source:target.source,source_sha256:'exact-source-'+suffix,rate_snapshot:target.rates,assignee_id:null,revision:1,calculation:null});
const makeCalc=(plan)=>({...plan.pay.values,...{grossCents:plan.pay.grossCents,netCents:plan.pay.netCents,deductionCents:plan.pay.deductionCents},
 paidMinutes:plan.target.source.paidMinutes,rateSnapshot:plan.pay.rateSnapshot,method:'actual-canonical-v1',currency:'PLN'});
const fakeIssue=d=>({id:d.id,document:{source:d.source,calculation:d.calculation,sourceSha256:d.source_sha256}});

test('separate exact archived tab cards; actual saved hours and independently effective gross rates determine gross and net',()=>{
 const ctx=context(),groups=simpleSourceGroups(ctx),g=chosen(ctx);
 assert.equal(groups.length,2);
 assert.equal(g.targets.length,3);
 assert.equal(g.targets.find(x=>x.source.workerKey===three).rates,undefined);
 const [x,y]=payPlan(ctx);
 assert.equal(x.pay.values.mode,'saved-rates');
 assert.equal(x.pay.grossCents,300000);assert.equal(x.pay.netCents,270000);
 assert.equal(y.pay.grossCents,290000);assert.equal(y.pay.netCents,290000);
 assert.ok(x.target.rates.every(r=>r.cents===3000&&r.scope==='individual'));
 assert.ok(y.target.rates.every(r=>r.cents===2900));
 assert.equal(simplePayValues(x.target,{deductions:[{name:'',amount:'100'}]}),undefined);
 assert.equal(simplePayValues(x.target,{deductions:[{name:'Exceeds amount',amount:'3000.01'}]}),undefined);
 assert.equal(simpleSourceGroups(context({role:'worker'})).length,0);
 const groupsOnly=context({rates:[rate(null,3100,503,'gross',from,group)]});
 assert.equal(chosen(groupsOnly).targets[0].rates[0].scope,'group');
});

test('current multi-rate by each date; changed source/rate/draft, overlapping issued period, delegated/legacy do not enter simple send',()=>{
 const ctx=context(),g=chosen(ctx);
 const updatedRate=context({rates:[...ctx.rates,rate(one,3200,505,'gross','2026-11-06')]});
 const next=chosen(updatedRate).targets[0];assert.equal(simplePayValues(next,deductions).grossCents,310000);
 const selection=new Map([[one,deductions]]);
 assert.equal(buildSimpleIssuePlan(g,updatedRate,selection),undefined);
 const sourceChange={...a,rows:a.rows.map((r,i)=>i===0?{...r,revision:2}:r)};
 assert.equal(buildSimpleIssuePlan(g,context({sources:[sourceChange,b]}),selection),undefined);
 const frozen=makeDraft(g.targets[0]);
 assert.equal(chosen(context({drafts:[{...frozen,assignee_id:id(99)}]})).targets.some(x=>x.source.workerKey===one),false);
 assert.equal(chosen(context({drafts:[{...frozen,calculation:{mode:'gross-total',note:'manual history'}}]})).targets.some(x=>x.source.workerKey===one),false);
 assert.equal(chosen(context({published:[{document:{source:{...a,sourceId:id(991)}}}]})).targets.some(x=>x.source.workerKey===one),false);
 const resumed={...frozen,calculation:makeCalc(payPlan()[0]),revision:2};
 const fresh=context({drafts:[resumed]});
 assert.equal(existingSimpleValues(chosen(fresh).targets[0].draft).deductions[0].amount,'100.00');
 assert.deepEqual(existingSimpleValues(undefined),blankSimplePay());
 assert.equal(buildSimpleIssuePlan(g,fresh,selection),undefined);
 assert.equal(buildSimpleIssuePlan(chosen(fresh),fresh,selection).length,1);
});

test('one action uses exact receipts in create/save/issue sequence, and rate/issue mismatch never confirms delivery',async()=>{
 const plan=payPlan();
 let seq=0;
 const operation=()=>id(900+ ++seq);
 function fixture({badCreate=false,badIssue=false}={}){
  const calls=[],drafts=new Map();
  return {calls,call:async(action,body)=>{
   calls.push([action,body]);
   if(action==='create'){
    const p=plan.find(x=>x.target.source.workerKey===body.memberId),d=makeDraft(p.target,p===plan[0]?1:2);
    if(badCreate&&p===plan[0])d.rate_snapshot=d.rate_snapshot.map(r=>({...r,cents:r.cents+1}));
    drafts.set(d.id,{d,p});return d;
   }
   const row=drafts.get(body.id);
   if(action==='save'){assert.deepEqual(body.values,row.p.pay.values);row.d={...row.d,revision:2,calculation:makeCalc(row.p)};return row.d;}
   assert.equal(body.confirmed,true);
   const issued=fakeIssue(row.d);
   if(badIssue&&row.p===plan[0])issued.document.sourceSha256='different-checksum';
   return issued;
  }};
 }
 const success=fixture();
 assert.deepEqual(await issueSimplePlans(plan,success.call,v=>v,operation),[{memberId:one,status:'issued'},{memberId:two,status:'issued'}]);
 assert.deepEqual(success.calls.map(([x])=>x),['create','save','issue','create','save','issue']);
 const create=fixture({badCreate:true});
 assert.deepEqual(await issueSimplePlans(plan,create.call,v=>v,operation),[{memberId:one,status:'uncertain'},{memberId:two,status:'notAttempted'}]);
 assert.deepEqual(create.calls.map(([x])=>x),['create']);
 const issued=fixture({badIssue:true});
 assert.deepEqual(await issueSimplePlans(plan,issued.call,v=>v,operation),[{memberId:one,status:'uncertain'},{memberId:two,status:'notAttempted'}]);
 assert.deepEqual(issued.calls.map(([x])=>x),['create','save','issue']);
 assert.match(SIMPLE_PAY_NOTE,/zapis/);
});

test('notification destination verifies an exact own receipt before opening; simple send translations are complete',()=>{
 const src=p=>readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
 const page=src('hosted/PayslipsPage.tsx');
 assert.match(page,/receipt\.id!==readId\|\|scope\?\.role==='worker'&&receipt\.document\.source\.workerKey!==scope\.membershipId/);
 assert.match(page,/!c\.published\.some\(p=>p\.id===target\)/);
 assert.match(page,/onPublicationOpened\(receipt\.id\)/);
 assert.match(page,/id=\{'payslip-'\+document\.id\}/);
 for(const lang of ['en','pl','ru','uk']){
  const simple=JSON.parse(src('i18n/locales/'+lang+'.json')).canonicalPayslips.simple;
  for(const key of ['title','intro','source','send','rateDistinction','setOfficialRate','missingRates','confirmation','result'])assert.ok(simple[key]);
 }
});

test('an explicit draft-only rate covers missing, net-only and mixed snapshots, while no edit preserves recorded rates',()=>{
 const ctx=context(), g=chosen(ctx), first=g.targets.find(x=>x.source.workerKey===one), noGross=g.targets.find(x=>x.source.workerKey===three);
 assert.equal(simpleSavedGrossRate(first),'30.00');
 assert.equal(simpleSavedGrossRate(noGross),undefined);
 assert.equal(simplePayValues(noGross,blankSimplePay()),undefined);
 assert.equal(simplePayValues(noGross,{...blankSimplePay(),grossRateOverride:'29'}).netCents,290000);
 const absent=chosen(context({rates:[]})).targets[0];
 assert.equal(simplePayValues(absent,{...blankSimplePay(),grossRateOverride:'29,01'}).grossCents,290100);
 const edited=simplePayValues(first,{...deductions,grossRateOverride:'33'});
 assert.equal(edited.grossCents,330000);
 assert.equal(edited.netCents,300000);
 assert.equal(edited.values.mode,'gross-rate');
 assert.equal(edited.values.amountCents,3300);
 assert.deepEqual(edited.rateSnapshot,[]);
 for(const value of ['', '0', '-29','29.001','10000.01','1e3'])
  assert.equal(simplePayValues(first,{...deductions,grossRateOverride:value}),undefined);
 const mixedCtx=context({rates:[...ctx.rates,rate(one,3200,505,'gross','2026-11-06')]});
 const mixed=chosen(mixedCtx).targets[0];
 assert.equal(simpleSavedGrossRate(mixed),undefined);
 assert.equal(simplePayValues(mixed,deductions).values.mode,'saved-rates');
 assert.equal(simplePayValues(mixed,deductions).grossCents,310000);
 assert.equal(simplePayValues(mixed,{...deductions,grossRateOverride:'33'}).grossCents,330000);
});

test('interrupted gross-rate draft resumes idempotently with its stored override, without adopting legacy or weakening receipt',async()=>{
 const ctx=context({rates:[]}), g=chosen(ctx), input={...deductions,grossRateOverride:'33'};
 const [plan]=buildSimpleIssuePlan(g,ctx,new Map([[one,input]]));
 const created=makeDraft(g.targets[0]);
 created.rate_snapshot=[]; // no pre-existing gross rates
 const saved={...created,revision:2,calculation:makeCalc(plan)};
 const calls=[];let seq=0;
 const freshId=()=>id(901+seq++);
 const first=await issueSimplePlans([plan],async(action,body)=>{
  calls.push(action);
  if(action==='create')return created;
  if(action==='save'){assert.equal(body.values.amountCents,3300);return saved}
  throw Error('unavailable');
 },v=>v,freshId);
 assert.deepEqual(first,[{memberId:one,status:'uncertain'}]);
 assert.deepEqual(calls,['create','save','issue']);
 const fresh=context({rates:[],drafts:[saved]});
 const t=chosen(fresh).targets[0];
 assert.deepEqual(existingSimpleValues(t.draft),{grossRateOverride:'33.00',
  deductions:[{name:'PIT',amount:'100.00'},{name:'Other actual adjustment',amount:'200.00'}]});
 const resumed=buildSimpleIssuePlan(chosen(fresh),fresh,new Map([[one,existingSimpleValues(t.draft)]]));
 const retries=[];
 assert.deepEqual(await issueSimplePlans(resumed,async(action,body)=>{
  retries.push(action);assert.equal(body.revision,2);return fakeIssue(saved);
 },v=>v,freshId),[{memberId:one,status:'issued'}]);
 assert.deepEqual(retries,['issue']);
 assert.deepEqual(await issueSimplePlans(resumed,async()=>{const receipt=fakeIssue(saved);receipt.document.calculation={...saved.calculation,amountCents:3000};return receipt},v=>v,freshId),
  [{memberId:one,status:'uncertain'}]);
 const stale={...a,rows:a.rows.map((r,i)=>i===0?{...r,revision:2}:r)};
 assert.equal(buildSimpleIssuePlan(chosen(fresh),{...fresh,sources:[stale,b]},new Map([[one,input]])),undefined);
 const legacy=context({rates:[],drafts:[{...saved,calculation:{...saved.calculation,note:'Prior legacy note'}}]});
 assert.equal(chosen(legacy).targets.some(t=>t.source.workerKey===one),false);
});
