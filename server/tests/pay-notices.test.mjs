import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {createPayNoticeHandler} from '../lib/pay-notices.server.mjs';

const origin='https://timeax.pl',org='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',pub='33333333-3333-4333-8333-333333333333';
const req=(action,input,from=origin)=>new Request(origin+'/api/pay-notices/'+org+'/'+action,input?{
 method:'POST',headers:{origin:from,'Content-Type':'application/json'},body:JSON.stringify(input)
}:{});
test('worker notification feed strips payroll fields; it is worker- and workspace-scoped',async()=>{
 const row={id:pub,at:'2026-11-27T22:00:00Z',read:false,state:'active',document:{netCents:270000}};
 let result={organizationId:org,membershipId:member,items:[row]},role='worker';
 const calls=[];
 const session=()=>({issuer:ISSUER,subject:'own worker',state:'verified',emailConfirmed:true,isAnonymous:false,expiresAt:10,isActive:async()=>true,workspaceRole:role,workspaceMembershipId:member});
 const handler=createPayNoticeHandler({origin,resolveSession:async()=>session(),now:()=>0,store:{invoke:async(...data)=>{calls.push(data);return result}}});
 const response=await handler(req('context'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store, private');
 assert.deepEqual((await response.json()).items,[{id:pub,at:row.at,read:false,state:'active'}]);
 result={...result,membershipId:pub};assert.equal((await handler(req('context'))).status,503);
 role='agency_admin';assert.equal((await handler(req('context'))).status,401);assert.equal(calls.length,2);
});
test('worker must use same origin and exact fields to read or archive a notice',async()=>{
 const session={issuer:ISSUER,subject:'own worker',state:'verified',emailConfirmed:true,isAnonymous:false,expiresAt:10,isActive:async()=>true,workspaceRole:'worker',workspaceMembershipId:member};
 let result={read:true};const calls=[];
 const handler=createPayNoticeHandler({origin,resolveSession:async()=>session,now:()=>0,store:{invoke:async(...data)=>{calls.push(data);return result}}});
 assert.equal((await handler(req('read',{id:pub},'https://external.test'))).status,403);
 assert.equal((await handler(req('read',{id:pub,worker:member}))).status,400);
 assert.equal((await handler(req('state',{id:pub,state:'bad'}))).status,400);
 assert.equal(calls.length,0);
 assert.deepEqual(await (await handler(req('read',{id:pub}))).json(),{read:true});
 result={state:'archived'};
 assert.deepEqual(await (await handler(req('state',{id:pub,state:'archived'}))).json(),{state:'archived'});
 assert.deepEqual(calls.map(c=>[c[1],c[2]]),[['read',{id:pub,organizationId:org}],['state',{id:pub,state:'archived',organizationId:org}]]);
});
