import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgencyOperations,managedAgencyOperations} from '../lib/agency-operations.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
const organization='12345678-1234-4123-8123-123456789012',membership='22345678-1234-4123-8123-123456789012',foreign='32345678-1234-4123-8123-123456789012';
const origin='https://timeax.pl';
const signatures={profile:'agency_profile(text,text,uuid,text)',timecards:'timecards(text,text,text,jsonb)',team:'team_workflow(text,text,text,jsonb,jsonb)',account:'account_lifecycle(text,text,text,jsonb)'};
const credentials=Object.fromEntries(Object.entries(signatures).map(([key,name],i)=>[key,{password:String(i).repeat(43),hashes:{['timeax_api.'+name]:'a'.repeat(64)},...(key==='team'?{inviteKey:'b'.repeat(43)}:{})}]));
function fixture({role='agency_admin',active=true,failed=''}={}){
 const writes=[];
 const config={origin,selfService:true,workspaceReadPassword:'x'.repeat(43),agencyOperations:credentials};
 const lane=({role:dbRole})=>{
  return {async preflight(){if(dbRole===failed)throw Error('Unavailable')},async query(_sql,args){
   if(dbRole==='timeax_workspace_read_login')return {rows:args[2]===organization?[{membership_id:membership,organization_id:organization,organization_kind:'agency',role,worksites:[]}]:[]};
   writes.push({dbRole,args});
   return {rows:[{value:dbRole==='timeax_agency_profile_login'?{organizationId:organization,name:args[3]??'Fixture Agency',nip:null,nipVerified:false}:{organizationId:organization}}]};
  }};
 };
 const session={state:'verified',issuer:ISSUER,subject:'fixture',email:'fixture@example.test',emailConfirmed:true,isAnonymous:false,expiresAt:5,isActive:async()=>active};
 return {writes,module:assembleAgencyOperations(config,lane,{now:()=>1}).then(bind=>bind(async r=>r.headers.has('cookie')?session:{state:'anonymous'}))};
}
function request(path,body,authenticated=true){
 return new Request(origin+path,{method:body?'POST':'GET',headers:{origin,...(authenticated?{cookie:'identity=fixture'}:{}),...(body?{'content-type':'application/json'}:{})},body:body&&JSON.stringify(body)});
}
test('only the enabled agency-owned contexts and settings are mounted',async()=>{
 const {writes,module}=fixture(),ops=await module;
 assert.deepEqual(new Set(ops.enabled),new Set(['timecards','account','team','profile']));
 const own='/api/agency-profile/'+organization+'/settings',other='/api/agency-profile/'+foreign+'/settings';
 assert.equal(ops.find('/api/timecards/'+organization+'/create'),undefined);
 assert.equal(ops.find('/api/team/accept-accountant'),undefined);
 assert.equal(ops.find('/api/personal-account/delete'),undefined);
 assert.equal((await ops.find(own)(request(own,{name:'Renamed Agency'},false))).status,401);
 assert.equal((await ops.find(other)(request(other,{name:'Renamed Agency'}))).status,401);
 assert.equal((await ops.find(own)(request(own,{name:'x'}))).status,400);
 assert.equal(writes.length,0);
 const r=await ops.find(own)(request(own,{name:'Renamed Agency'}));
 assert.equal(r.status,200);
 assert.equal((await r.json()).name,'Renamed Agency');
 assert.equal(writes.length,1);
 assert.equal(writes[0].args[2],organization);
});
test('unknown role and runtime lane failure cannot enable a section',async()=>{
 const {writes,module}=fixture({role:'worker',failed:'timeax_timecards_login'}),ops=await module;
 assert.equal(ops.enabled.includes('timecards'),false);
 const own='/api/agency-profile/'+organization+'/settings';
 assert.equal((await ops.find(own)(request(own,{name:'Renamed Agency'}))).status,401);
 assert.deepEqual(writes,[]);
});
test('agency schedule is read-only and other team actions stay enabled',async()=>{
 const {writes,module}=fixture(),ops=await module;
 const root='/api/team/'+organization+'/';
 for(const action of ['schedule','update-plan','cancel'])assert.equal(ops.find(root+action),undefined);
 assert.equal((await ops.find(root+'context')(request(root+'context'))).status,200);
 assert.deepEqual(writes.map(({dbRole,args})=>[dbRole,args[2]]),[['timeax_team_login','context']]);
 for(const action of ['read','message','invite-accountant','revoke-accountant'])assert.equal(typeof ops.find(root+action),'function');
});
test('managed Team pin can be refreshed independently without touching other credentials',()=>{
 const env={TIMEAX_AGENCY_OPERATIONS:JSON.stringify(credentials)};
 const signature='timeax_api.team_workflow(text,text,text,jsonb,jsonb)';
 assert.deepEqual(managedAgencyOperations({...env,TIMEAX_AGENCY_TEAM_RPC_SHA256:'bad'}),credentials);
 const updated=managedAgencyOperations({...env,TIMEAX_AGENCY_TEAM_RPC_SHA256:'c'.repeat(64)});
 assert.equal(updated.team.hashes[signature],'c'.repeat(64));
 assert.deepEqual(updated.timecards,credentials.timecards);
 assert.equal(updated.team.password,credentials.team.password);
 assert.equal(updated.team.inviteKey,credentials.team.inviteKey);
 assert.equal(managedAgencyOperations({TIMEAX_AGENCY_TEAM_RPC_SHA256:'c'.repeat(64)}),null);
});
