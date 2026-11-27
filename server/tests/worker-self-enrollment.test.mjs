import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgencyOperations} from '../lib/agency-operations.mjs';
import {INTEGRATED_LANES} from '../lib/integrated.contract.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {WORKER_TERMS_ROLE,WORKER_TERMS_SQL,WORKER_TERMS_VERSION,WORKER_TERMS_SHA256} from '../lib/worker-terms.mjs';
import {WORKER_SQL} from '../lib/worker-enrollment.server.mjs';

const origin='https://timeax.pl', org='12345678-1234-4123-8123-123456789012';
const subject='22345678-1234-4123-8123-123456789013', application='42345678-1234-4123-8123-123456789012';
const nip='5260250274', code='d'.repeat(64), path='/api/worker-enrollment/';
const worker=INTEGRATED_LANES.find(({id})=>id==='worker');
const config={origin,selfService:true,workspaceReadPassword:'w'.repeat(43),agencyOperations:{
 worker:{password:'k'.repeat(43),hashes:Object.fromEntries(worker.functions.map(fn=>[fn.signature,'f'.repeat(64)]))},
 workerTerms:{password:'t'.repeat(43),sha:'f'.repeat(64)}}};
const s={state:'verified',issuer:ISSUER,subject,emailConfirmed:true,isAnonymous:false,expiresAt:1000,isActive:async()=>true};
function req(route,body,isSignedIn=true){
 return new Request(origin+path+route,{method:body?'POST':'GET',headers:{origin,...(isSignedIn?{cookie:'fixture=true'}:{}),...(body?{'content-type':'application/json'}:{})},body:body&&JSON.stringify(body)});
}
test('hosted worker entry uses the scoped database lane and the session actor for both connection paths',async()=>{
 const calls=[];
 const bind=await assembleAgencyOperations(config,({role})=>({async preflight(){},async query(sql,args){
  if(role===WORKER_TERMS_ROLE){
   assert.equal(sql,WORKER_TERMS_SQL);
   assert.deepEqual(args,['status',ISSUER,subject,null]);
   return {rows:[{value:{accepted:true,version:WORKER_TERMS_VERSION,documentSha256:WORKER_TERMS_SHA256,acceptedAt:'2026-11-27T12:00:00.000Z'}}]};
  }
  assert.equal(role,worker.role);
  calls.push([sql,args]);
  if(sql===WORKER_SQL.context)return {rows:[{value:{memberships:[],applications:[]}}]};
  if(sql===WORKER_SQL.lookup)return {rows:[{agency_id:org,name:'Fixture Agency',nip}]};
  if(sql===WORKER_SQL.queue)return {rows:[]};
  return {rows:[{application_id:application,status:'pending'}]};
 }}),{now:()=>1});
 const ops=bind(async request=>request.headers.has('cookie')?s:{state:'anonymous'});
 assert.equal(ops.workerSelfService,true);
 assert.equal(ops.find(path+'random'),undefined);
 assert.equal((await ops.find(path+'context')(req('context',undefined,false))).status,401);
 assert.equal(calls.length,0);
 assert.equal((await ops.find(path+'claim')(req('claim',{code,subject:'other'}))).status,400);
 assert.equal(calls.length,0);
 for(const [name,body] of [['context'],['lookup',{nip}],['request',{agencyId:org,nip}],['claim',{code}],['agency/'+org]]){
  const r=await ops.find(path+name)(req(name,body));
  assert.equal(r.status,200);
  assert.match(r.headers.get('cache-control'),/no-store/);
 }
 assert.deepEqual(calls,[
  [WORKER_SQL.context,[ISSUER,subject]],[WORKER_SQL.lookup,[ISSUER,subject,nip]],
  [WORKER_SQL.request,[ISSUER,subject,org,nip]],[WORKER_SQL.claim,[ISSUER,subject,code]],
  [WORKER_SQL.queue,[ISSUER,subject,org]]
 ]);
});
test('worker entry is not advertised without a verified scoped lane',async()=>{
 const bind=await assembleAgencyOperations(config,()=>({async preflight(){throw Error('lane unreachable')}}));
 assert.equal(bind,null);
});
