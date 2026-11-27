import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFactorySetupHandler} from '../lib/factory-enrollment.server.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl';
const org='22222222-2222-4222-8222-222222222222',site='11111111-1111-4111-8111-111111111111';
const base={organizationId:org,worksiteId:site};
const save={...base,id:null,revision:null,kind:'group',name:'Morning',departmentId:null,leaderId:null,workers:[]};
function handler({productionRoles=true,verified=true,invoke}={}){
 return createFactorySetupHandler({origin,now:()=>1,productionRoles,
  resolveSession:async()=>verified?{state:'verified',issuer:ISSUER,subject:'fixture',emailConfirmed:true,isAnonymous:false,expiresAt:100,isActive:async()=>true}:null,
  store:{invoke:invoke??(async()=>({ok:true}))}});
}
function call(run,action,body,headers={}){
 return run(new Request(origin+'/api/factory-setup/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
}
test('factory metadata and schedule exact HTTP contract keeps old profiles closed',async()=>{
 const accepted=[];
 const run=handler({invoke:async(actor,action,input)=>{accepted.push([actor.subject,action,input]);return {ok:true}}});
 assert.equal((await call(handler({productionRoles:false}),'factory-roster',base)).status,404);
 assert.equal((await call(handler({verified:false}),'factory-roster',base)).status,401);
 assert.equal((await call(run,'factory-roster',base,{Origin:'https://another.invalid'})).status,403);
 assert.equal((await call(run,'factory-roster',{...base,role:'factory_admin'})).status,400);
 assert.equal((await call(run,'factory-schedule',{...base,dateFrom:'2026-11-31',dateTo:'2026-12-02'})).status,400);
 assert.equal((await call(run,'factory-schedule',{...base,dateFrom:'2026-11-01',dateTo:'2026-12-15'})).status,400);
 assert.equal((await call(run,'factory-unit-save',{...save,workers:[site,site]})).status,400);
 assert.equal((await call(run,'factory-unit-save',{...save,kind:'department',leaderId:site})).status,400);
 assert.equal((await call(run,'factory-unit-archive',{...base,id:site,revision:1.5})).status,400);
 assert.equal((await call(run,'factory-unit-save',save)).status,200);
 assert.equal((await call(run,'factory-schedule',{...base,dateFrom:'2026-11-01',dateTo:'2026-11-30'})).status,200);
 assert.deepEqual(accepted.map(x=>x.slice(0,2)),[['fixture','factory-unit-save'],['fixture','factory-schedule']]);
});
test('factory case reports scope denial and stale revision without database details',async()=>{
 for(const [error,status] of [['42501',403],['23505',409]]){
  const response=await call(handler({invoke:async()=>{throw Object.assign(new Error('private row'),{code:error})}}),'factory-unit-archive',{...base,id:site,revision:1});
  assert.equal(response.status,status); assert.doesNotMatch(await response.text(),/private row/);
 }
});
