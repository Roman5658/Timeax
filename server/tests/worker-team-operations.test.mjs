import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgencyOperations} from '../lib/agency-operations.mjs';
import {INTEGRATED_LANES} from '../lib/integrated.contract.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {WORKER_TERMS_ROLE,WORKER_TERMS_VERSION,WORKER_TERMS_SHA256} from '../lib/worker-terms.mjs';

const origin='https://timeax.pl',org='12345678-1234-4123-8123-123456789012',foreign='12345678-1234-4123-8123-123456789013';
const member='22345678-1234-4123-8123-123456789012',id='32345678-1234-4123-8123-123456789012';
const site='42345678-1234-4123-8123-123456789012',op='52345678-1234-4123-8123-123456789012';
const subject='62345678-1234-4123-8123-123456789012',email='worker@example.test';
const root='/api/team/'+org+'/';
const absence={operationId:op,siteId:site,payload:{dateFrom:'2026-11-27',dateTo:'2026-11-27'}};
const template={operationId:op,id:null,revision:null,name:'Morning',data:{startTime:'06:00',endTime:'14:00',breakMinutes:15,breakTreatment:'unpaid'}};
function req(path,body,from=origin){return new Request(origin+path,{method:body?'POST':'GET',headers:{origin:from,cookie:'identity=fixture',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function setup({accepted=true,role='worker',kind='agency',misproject=false,manualEntry=true,worksites=[{id:site,name:'Site'}]}={}){
 const calls=[];
 const configs=Object.fromEntries(INTEGRATED_LANES.filter(l=>['worker','timecards','factoryTimecards','names','payroll'].includes(l.id)).map((v,i)=>[v.id,{
  password:String(i).repeat(43),hashes:Object.fromEntries(v.functions.map(fn=>[fn.signature,'a'.repeat(64)]))
 }]));
 const config={origin,selfService:true,workspaceReadPassword:'w'.repeat(43),agencyOperations:{...configs,
  team:{password:'t'.repeat(43),hashes:{'timeax_api.team_workflow(text,text,text,jsonb,jsonb)':'a'.repeat(64)},inviteKey:'i'.repeat(43)},
  workerTerms:{password:'z'.repeat(43),sha:'a'.repeat(64)}}};
 const bind=await assembleAgencyOperations(config,({role:dbRole})=>({async preflight(){},async query(_sql,args){
  if(dbRole==='timeax_workspace_read_login')return {rows:args[2]===org?[{membership_id:member,organization_id:org,organization_kind:kind,role,worksites}]:[]};
  if(dbRole===WORKER_TERMS_ROLE)return {rows:[{value:{accepted,version:WORKER_TERMS_VERSION,documentSha256:WORKER_TERMS_SHA256,acceptedAt:accepted?'2026-11-27T12:00:00Z':null}}]};
  const action=args[2],input=JSON.parse(args[3]);calls.push({dbRole,actor:args.slice(0,2),action,input});
  if(dbRole==='timeax_timecards_login'&&action==='context')return {rows:[{value:{organizationId:org,membershipId:member,role,worksites:[{id:site,manualEntry}]}}]};
  if(dbRole==='timeax_timecards_login'&&action==='create')return {rows:[{value:{id,revision:1,saved:true}}]};
  if(dbRole==='timeax_factory_timecards_login'&&action==='create')return {rows:[{value:{id,revision:1,state:'needs-review'}}]};
  if(dbRole==='timeax_member_names_login')return {rows:[{value:{organizationId:org,canEdit:false,workers:[{organizationId:org,membershipId:misproject?foreign:member}]}}]};
  if(dbRole==='timeax_payroll_login'){
   const publication={id,document:{source:{agencyId:org,workerKey:misproject?foreign:member}}};
   return {rows:[{value:action==='read'?publication:{organizationId:org,membershipId:member,role,settings:null,
    workers:[],accountants:[],groups:[],rates:[],groupAssignments:[],sources:[],drafts:[],published:[publication]}}]};
  }
  if(dbRole==='timeax_team_login'){
   if(action==='context')return {rows:[{value:{organizationId:org,membershipId:member,role,sites:[],recipients:[],entries:[],unread:1,templates:[],invitations:[]}}]};
   if(action==='read'){
    if(input.id!==id)throw Object.assign(Error('not your delivery'),{code:'42501'});
    return {rows:[{value:{read:true}}]};
   }
   if(action==='delete-template')return {rows:[{value:{deleted:true}}]};
   if(action==='save-template')return {rows:[{value:{id,revision:1}}]};
   if(action==='absence'&&input.siteId!==site)throw Object.assign(Error('not your site'),{code:'42501'});
  }
  return {rows:[{value:{organizationId:org,id,revision:1,state:action==='cancel'?'cancelled':'active'}}]};
 }}),{now:()=>1});
 const ops=bind(async()=>({state:'verified',issuer:ISSUER,subject,email,emailConfirmed:true,isAnonymous:false,expiresAt:100,isActive:async()=>true}));
 return {calls,ops,dispatch:async(path,body,from)=>ops.find(path)(req(path,body,from))};
}
test('canonical worker team routes read own, persist valid actions, and validate date/identity boundaries',async()=>{
 const {calls,dispatch}=await setup();
 const result=await dispatch(root+'context');
 assert.equal(result.status,200);assert.equal((await result.json()).unread,1);
 assert.equal((await dispatch(root+'read',{id})).status,200);
 assert.equal((await dispatch(root+'read',{id:foreign})).status,403);
 assert.equal((await dispatch(root+'absence',absence)).status,200);
 assert.equal((await dispatch(root+'absence',{...absence,siteId:foreign})).status,403);
 assert.equal((await dispatch(root+'absence',{...absence,payload:{dateFrom:'2026-02-30',dateTo:'2026-02-30'}})).status,400);
 assert.equal((await dispatch(root+'absence',{...absence,payload:{dateFrom:'2026-11-27',dateTo:'2026-10-27'}})).status,400);
 assert.equal((await dispatch(root+'save-template',template)).status,200);
 assert.equal((await dispatch(root+'delete-template',{operationId:op,id,revision:1})).status,200);
 assert.equal((await dispatch(root+'update-plan',{operationId:op,id,revision:1,payload:absence.payload})).status,200);
 assert.equal((await dispatch(root+'cancel',{operationId:op,id,revision:1})).status,200);
 assert.equal((await dispatch(root+'invite-accountant',{operationId:op,email})).status,401);
 assert.equal((await dispatch(root+'message',{},'https://other.example')).status,403);
 assert.equal((await dispatch('/api/team/'+foreign+'/context')).status,401);
 assert.ok(calls.every(x=>x.input.organizationId===org&&x.actor[0]===ISSUER&&x.actor[1]===subject));
});
test('worker terms and agency read-only schedule are required before invoking team RPC',async()=>{
 const worker=await setup({accepted:false});
 assert.equal((await worker.dispatch(root+'context')).status,401);
 assert.equal((await worker.dispatch(root+'save-template',template)).status,401);
 assert.deepEqual(worker.calls,[]);
 const agency=await setup({role:'agency_admin'});
 assert.equal((await agency.dispatch(root+'context')).status,200);
 assert.equal((await agency.dispatch(root+'absence',absence)).status,401);
 assert.equal((await agency.dispatch(root+'cancel',{operationId:op,id,revision:1})).status,401);
 assert.deepEqual(agency.calls.map(x=>x.action),['context']);
});

test('the approved worker read paths never disclose a misprojected label, payslip or draft',async()=>{
 const good=await setup(),bad=await setup({misproject:true});
 const name='/api/member-names/'+org+'/',pay='/api/payslips/'+org+'/';
 for(const path of [name+'context',pay+'context',pay+'read/'+id]){
  assert.equal((await good.dispatch(path)).status,200);
  const denied=await bad.dispatch(path);
  assert.equal(denied.status,503);assert.deepEqual(await denied.json(),{error:'unavailable'});
 }
 for(const path of [name+'set',pay+'issue'])assert.equal((await good.dispatch(path,{})).status,401);
 assert.equal((await good.dispatch('/api/member-names/'+foreign+'/context')).status,401);
 assert.equal((await good.dispatch('/api/payslips/'+foreign+'/read/'+id)).status,401);
});
test('worker entry gets its site and membership from the session scope, not the submitted form',async()=>{
 const worker=await setup(),agency=await setup({role:'agency_admin'});
 const route='/api/factory-timecards/'+org+'/';
 const draft={operationId:op,localDate:'2026-11-27',startTime:'06:00',endTime:'14:00',
  breakStatus:'not-taken',breakMinutes:0,breakTreatment:'unpaid',comment:''};
 const r=await worker.dispatch(route+'create',draft);assert.equal(r.status,200);assert.deepEqual(await r.json(),{id,revision:1,saved:true});
 assert.equal((await worker.dispatch(route+'create',{...draft,membershipId:foreign})).status,403);
 assert.equal((await worker.dispatch(route+'create',{...draft,worksiteId:site})).status,403);
 assert.equal((await worker.dispatch(route+'propose-placement',{})).status,401);
 assert.equal((await worker.dispatch(route+'correct',draft)).status,401);
 assert.equal((await agency.dispatch(route+'create',draft)).status,401);
 const internal='/api/timecards/'+org+'/create';
 assert.equal((await worker.dispatch(internal,draft)).status,200);
 assert.equal((await worker.dispatch(internal,{...draft,worksiteId:site})).status,400);
 assert.equal((await worker.dispatch(internal,{...draft,breakStatus:'not-reported',breakMinutes:15})).status,400);
 for(const worksites of [[],[{id:site,name:'Site'},{id:foreign,name:'Other'}]]){
  const blocked=await setup({worksites});assert.equal((await blocked.dispatch(route+'create',draft)).status,409);
  assert.equal((await blocked.dispatch(internal,draft)).status,409);assert.deepEqual(blocked.calls,[]);
 }
 assert.deepEqual(worker.calls.map(x=>[x.action,x.input.membershipId,x.input.worksiteId]),[['create',member,site],['context',undefined,undefined],['create',undefined,site]]);
 const oldDatabase=await setup({manualEntry:false});
 assert.equal((await oldDatabase.dispatch(internal,draft)).status,403);
 assert.deepEqual(oldDatabase.calls.map(x=>x.action),['context']);
 assert.deepEqual(agency.calls,[]);
});

test('the three worker break choices retain their meaning and calculate paid minutes on the server',async()=>{
 const worker=await setup();const route='/api/timecards/'+org+'/create';
 const base={operationId:op,localDate:'2026-11-26',startTime:'06:00',endTime:'14:00',comment:''};
 for(const data of [
  {breakStatus:'not-reported',breakMinutes:0,breakTreatment:'unpaid'},
  {breakStatus:'taken',breakMinutes:30,breakTreatment:'unpaid'},
  {breakStatus:'taken',breakMinutes:0,breakTreatment:'paid'},
 ])assert.equal((await worker.dispatch(route,{...base,...data})).status,200);
 assert.deepEqual(worker.calls.filter(x=>x.action==='create').map(({input:{data}})=>[data.breakStatus,data.breakTreatment,data.paidMinutes]),
  [['not-reported','unpaid',480],['taken','unpaid',450],['taken','paid',480]]);
});

test('the hosted production workspace only mounts known role-specific operations',async()=>{
 const manager=await setup({role:'factory_admin',kind:'factory'}),leader=await setup({role:'team_leader',kind:'factory'});
 const hours='/api/factory-timecards/'+org+'/';
 assert.equal((await manager.dispatch(hours+'context')).status,200);
 assert.equal((await manager.dispatch(hours+'approve-placement',{worksiteId:site,id,operationId:op,confirmed:true})).status,200);
 assert.equal((await manager.dispatch(hours+'send',{})).status,401);
 assert.equal((await manager.dispatch(root+'context')).status,200);
 assert.equal((await manager.dispatch(root+'schedule',{})).status,401);
 assert.equal((await manager.dispatch(root+'invite-accountant',{})).status,401);
 assert.equal((await leader.dispatch(hours+'context')).status,200);
 assert.equal((await leader.dispatch(hours+'set-mode',{worksiteId:site,operationId:op,revision:0,mode:'attendance'})).status,200);
 assert.equal((await leader.dispatch(hours+'approve-placement',{})).status,401);
 assert.equal((await leader.dispatch(root+'context')).status,200);
 assert.equal((await leader.dispatch('/api/payslips/'+org+'/context')).status,401);
});
