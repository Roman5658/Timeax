import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgencyOperations} from '../lib/agency-operations.mjs';
import {INTEGRATED_LANES} from '../lib/integrated.contract.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {TEAM_FUNCTION} from '../lib/team-workflow.server.mjs';
import {WORKER_TERMS_ROLE,WORKER_TERMS_SHA256,WORKER_TERMS_VERSION} from '../lib/worker-terms.mjs';

const url='https://timeax.pl',uuid=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const org=uuid(1),member=uuid(2),other=uuid(3),site=uuid(4),subject=uuid(5),entry=uuid(6);
const root='/api/team/'+org+'/';
const message={operationId:uuid(7),siteId:site,recipients:[uuid(8)],payload:{text:'Fixture'}};
async function setup(role,accepted=false){
 const calls=[];
 const worker=INTEGRATED_LANES.find(l=>l.id==='worker');
 const config={origin:url,selfService:true,workspaceReadPassword:'w'.repeat(43),agencyOperations:{
  worker:{password:'r'.repeat(43),hashes:Object.fromEntries(worker.functions.map(f=>[f.signature,'a'.repeat(64)]))},
  workerTerms:{password:'a'.repeat(43),sha:'a'.repeat(64)},
  team:{password:'t'.repeat(43),inviteKey:'b'.repeat(43),hashes:{[TEAM_FUNCTION.signature]:'b'.repeat(64)}}
 }};
 const bind=await assembleAgencyOperations(config,({role:lane})=>({async preflight(){},async query(_s,args){
  if(lane==='timeax_workspace_read_login')return {rows:args[2]===org?[{membership_id:member,organization_id:org,organization_kind:'factory',role,worksites:[]}]:[]};
  if(lane===WORKER_TERMS_ROLE)return {rows:[{value:{version:WORKER_TERMS_VERSION,documentSha256:WORKER_TERMS_SHA256,accepted,acceptedAt:accepted?'2026-11-27T12:00:00Z':null}}]};
  calls.push(args);return {rows:[{value:{id:entry,revision:1,state:'active'}}]};
 }}),{now:()=>1});
 const ops=bind(async req=>req.headers.get('cookie')?{state:'verified',issuer:ISSUER,subject,email:'fixture@example.test',emailConfirmed:true,isAnonymous:false,
  expiresAt:100,isActive:async()=>true}:{state:'anonymous'});
 return {calls,async req(path,body,authenticated=true,caller=url){
  const request=new Request(url+path,{method:body?'POST':'GET',headers:{origin:caller,...(authenticated?{Cookie:'fixture=yes'}:{}),...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  return ops.find(path)(request);
 }};
}
test('factory administrators may use only scoped Team chat routes and never act across workspaces',async()=>{
 const f=await setup('factory_admin');
 assert.equal((await f.req(root+'context')).status,200);
 assert.equal((await f.req(root+'read',{id:entry})).status,200);
 assert.equal((await f.req(root+'message',message)).status,200);
 for(const action of ['absence','schedule','update-plan','cancel','save-template','invite-accountant'])
  assert.equal((await f.req(root+action,{})).status,401);
 assert.equal((await f.req('/api/team/'+other+'/context')).status,401);
 assert.equal((await f.req(root+'context',undefined,false)).status,401);
 assert.equal((await f.req(root+'message',message,true,'https://elsewhere.example')).status,403);
 assert.deepEqual(f.calls.map(a=>a[2]),['context','read','message']);
 assert.ok(f.calls.every(a=>a[0]===ISSUER&&a[1]===subject&&JSON.parse(a[3]).organizationId===org));
});
test('a direct factory worker needs current terms and cannot use factory chat to reach template/scheduling writes',async()=>{
 const allowed=await setup('worker',true),notAllowed=await setup('worker');
 assert.equal((await allowed.req(root+'context')).status,200);
 assert.equal((await allowed.req(root+'message',message)).status,200);
 assert.equal((await allowed.req(root+'save-template',{})).status,401);
 assert.equal((await allowed.req(root+'schedule',{})).status,401);
 assert.equal((await notAllowed.req(root+'context')).status,401);
 assert.equal((await notAllowed.req(root+'message',message)).status,401);
 assert.deepEqual(notAllowed.calls,[]);
});
