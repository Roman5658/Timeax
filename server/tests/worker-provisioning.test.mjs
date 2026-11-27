import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgencyOperations,managedAgencyOperations} from '../lib/agency-operations.mjs';
import {createWorkerEnrollmentHandler,WORKER_SQL} from '../lib/worker-enrollment.server.mjs';
import {createWorkerProvisioning,WORKER_PROVISIONING_ROLE,WORKER_PROVISIONING_SQL} from '../lib/worker-provisioning.mjs';
import {INTEGRATED_LANES} from '../lib/integrated.contract.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl', org='12345678-1234-4123-8123-123456789012';
const subject='22345678-1234-4123-8123-123456789013', invitation='42345678-1234-4123-8123-123456789012';
const nip='5260250274', code='d'.repeat(64), path='/api/worker-enrollment/';
const worker=INTEGRATED_LANES.find(({id})=>id==='worker'), email='worker@example.test';
const defaultConfig={origin,selfService:true,workspaceReadPassword:'w'.repeat(43),agencyOperations:{
 worker:{password:'k'.repeat(43),hashes:Object.fromEntries(worker.functions.map(fn=>[fn.signature,'f'.repeat(64)]))}}};
const cfg={...defaultConfig,agencyOperations:{...defaultConfig.agencyOperations,workerProvisioning:{password:'n'.repeat(43),sha:'d'.repeat(64)}}};
const s={state:'verified',issuer:ISSUER,subject,emailConfirmed:true,isAnonymous:false,expiresAt:1000,isActive:async()=>true};
const resolveSession=async request=>request.headers.has('cookie')?s:{state:'anonymous'};
function req(route,body,isSignedIn=true){
 return new Request(origin+path+route,{method:body?'POST':'GET',headers:{origin,...(isSignedIn?{cookie:'fixture=true'}:{}),...(body?{'content-type':'application/json'}:{})},body:body&&JSON.stringify(body)});
}
test('managed worker provisioning is independent and fails without changing legacy lane',async()=>{
 const env={TIMEAX_AGENCY_OPERATIONS:JSON.stringify(defaultConfig.agencyOperations),TIMEAX_WORKER_CONNECTION_DB:'n'.repeat(43),TIMEAX_WORKER_CONNECTION_RPC_SHA256:'d'.repeat(64)};
 assert.deepEqual(managedAgencyOperations(env),cfg.agencyOperations);
 assert.deepEqual(managedAgencyOperations({...env,TIMEAX_WORKER_CONNECTION_RSA_SHA256:undefined,TIMEAX_WORKER_CONNECTION_RPC_SHA256:'bad'}),defaultConfig.agencyOperations);
 const bind=await assembleAgencyOperations(cfg,({role})=>({async preflight(){if(role===WORKER_PROVISIONING_ROLE)throw Error('disabled')},async query(sql){assert.equal(sql,WORKER_SQL.context);return {rows:[{value:{memberships:[],applications:[]}}]}}}),{now:()=>1});
 const ops=bind(resolveSession);
 assert.equal(ops.provisioning,undefined);
 assert.deepEqual(ops.enabled,['worker']);
 assert.equal((await ops.find(path+'context')(req('context'))).status,200);
});
test('provisioning opens a worker sign-in only for an existing pending exact address',async()=>{
 const calls=[];
 const lane={async query(sql,args){assert.equal(sql,WORKER_PROVISIONING_SQL);calls.push(args);
  return {rows:[{value:{pending:JSON.parse(args[3]).email===email}}]};
 }};
 const p=createWorkerProvisioning(lane);
 assert.equal(await p.hasPending('   Worker@Example.Test   '),true);
 assert.equal(await p.hasPending('other@example.test'),false);
 assert.equal(await p.hasPending('bad'),false);
 assert.deepEqual(calls,[['admit',null,null,JSON.stringify({email})],['admit',null,null,JSON.stringify({email:'other@example.test'})]]);
 assert.equal(await createWorkerProvisioning({query(){throw Error('db outage')}}).hasPending(email),false);
});
test('worker connection mutations derive identity from authenticated session and require terms',async()=>{
 const calls=[];
 const provisioning={async call(action,actor,data){
  calls.push({action,actor,data});
  if(action==='list')return {invitations:[]};
  if(action==='accept')return {state:'connected',organizationId:org};
  if(action==='directory-lookup')return {agency:{agency_id:org,name:'Agency',nip,verified:false}};
  if(action==='directory-request'||action==='claim-code')return {application:{application_id:invitation,status:'pending'}};
  return {state:'prepared'};
 }};
 const store={async call(action){assert.equal(action,'lookup');return []}};
 let accepted=false;
 const handle=createWorkerEnrollmentHandler({origin,store,provisioning,resolveSession,now:()=>1,workerTerms:{accepted:async()=>accepted}});
 assert.equal((await handle(req('email-invitations',undefined,false))).status,401);
 assert.equal((await handle(req('claim',{code}))).status,409);
 assert.equal((await handle(req('request',{agencyId:org,nip}))).status,409);
 assert.equal((await handle(req('accept-email-invitation',{invitationId:invitation}))).status,409);
 assert.deepEqual(calls,[]);
 const prep=await handle(req('agency/'+org+'/provision',{email:'  '+email.toUpperCase()}));
 assert.deepEqual(await prep.json(),{state:'prepared'});
 assert.equal((await handle(req('agency/'+org+'/provision',{email,subject:'inject'}))).status,400);
 const found=await handle(req('lookup',{nip}));
 assert.equal((await found.json()).agency.verified,false);
 accepted=true;
 assert.equal((await handle(req('email-invitations'))).status,200);
 assert.equal((await handle(req('accept-email-invitation',{invitationId:invitation,email}))).status,400);
 assert.equal((await handle(req('accept-email-invitation',{invitationId:invitation}))).status,200);
 assert.equal((await handle(req('request',{agencyId:org,nip}))).status,200);
 assert.equal((await handle(req('claim',{code}))).status,200);
 assert.deepEqual(calls.map(x=>[x.action,x.data]),[['provision',{agencyId:org,email}],['directory-lookup',{nip}],['list',undefined],
  ['accept',{invitationId:invitation}],['directory-request',{agencyId:org,nip}],['claim-code',{code}]]);
 assert.ok(calls.every(x=>x.actor.issuer===ISSUER&&x.actor.subject===subject));
});

test('agency cards save the selected site but only send to an address reserved from a stored card',async()=>{
 const calls=[],sends=[];
 const app=createWorkerEnrollmentHandler({origin,resolveSession,now:()=>1,store:{},provisioning:{async call(action,actor,payload){
  assert.equal(actor.subject,subject);calls.push([action,payload]);
  if(action==='create-card')return {state:'prepared',cardId:invitation};
  if(action==='list-cards')return {cards:[]};
  if(action==='reserve-mail')return {state:'reserved',email,deliveryId:invitation,language:'pl'};
  if(action==='complete-mail')return {state:'submitted'};
  throw Error('unexpected');
 }},invitationMailer:{async send(p){sends.push(p);return {status:'submitted'}}}});
 const cards='agency/'+org+'/cards',send='agency/'+org+'/send-invitation';
 const worker={firstName:' Alice ',lastName:'Example',worksiteId:org,email};
 assert.equal((await app(req(cards,worker,false))).status,401);
 assert.equal((await app(req(cards,{...worker,lastName:'x@example.test'}))).status,400);
 assert.equal((await app(req(cards,worker))).status,200);
 assert.deepEqual(await (await app(req(cards))).json(),{cards:[],mailEnabled:true});
 assert.equal((await app(req(send,{cardId:invitation,email,language:'pl'}))).status,400);
 assert.equal((await app(req(send,{cardId:invitation,language:'pl'}))).status,200);
 assert.deepEqual(sends,[{email,deliveryId:invitation,language:'pl'}]);
 assert.deepEqual(calls.map(x=>x[0]),['create-card','list-cards','reserve-mail','complete-mail']);
});
