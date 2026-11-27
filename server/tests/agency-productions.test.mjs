import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFactorySetupHandler} from '../lib/factory-enrollment.server.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
const origin='https://timeax.pl',agency='22222222-2222-4222-8222-222222222222',foreign='11111111-1111-4111-8111-111111111111';
test('public agency production settings only use selected agency administrator scopes',async()=>{
 const invoked=[];
 const handler=createFactorySetupHandler({origin,agencyOnly:true,now:()=>1,
  resolveSession:async r=>r.headers.has('cookie')?{state:'verified',issuer:ISSUER,subject:'fixture',emailConfirmed:true,isAnonymous:false,expiresAt:100,isActive:async()=>true}:null,
  store:{async invoke(_actor,action){
   if(action==='context')return {memberships:[{organizationId:agency,role:'agency_admin',kind:'agency'},{organizationId:foreign,role:'factory_admin',kind:'factory'}],
    worksites:[{organizationId:agency},{organizationId:foreign}],connections:[{agencyId:agency,id:agency},{agencyId:foreign,id:foreign}]};
   invoked.push(action);return {state:'ok'};
  }}});
 const send=(action,body,loggedIn=true)=>handler(new Request(origin+'/api/factory-setup/'+action,{method:body?'POST':'GET',
  headers:{Origin:origin,...(loggedIn?{cookie:'fixture=1'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 assert.equal((await send('context',null,false)).status,401);
 const read=await (await send('context')).json();
 assert.deepEqual(read.memberships.map(x=>x.organizationId),[agency]);
 assert.deepEqual(read.worksites,[{organizationId:agency}]);
 assert.equal((await send('create-site',{organizationId:foreign,operationId:foreign,name:'Fixture'})).status,403);
 assert.equal((await send('create-site',{organizationId:agency,operationId:foreign,name:'Fixture'})).status,200);
 assert.equal((await send('approve-connection',{id:foreign,confirmed:true})).status,403);
 assert.equal((await send('approve-connection',{id:agency,confirmed:true})).status,200);
 assert.equal((await send('claim-leader',{code:'0'.repeat(64)})).status,404);
 assert.deepEqual(invoked,['create-site','approve-connection']);
});
