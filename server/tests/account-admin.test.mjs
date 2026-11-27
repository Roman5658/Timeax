import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAccountAdminHandler,managedAccountAdmin} from '../lib/account-admin.mjs';
const origin='https://timeax.pl',token='x'.repeat(43),id='22222222-2222-4222-8222-222222222222',email='only-fixture@example.test';
const keySha=createHash('sha256').update(token).digest('hex');

test('owner account removal requires the exact account preview and typed email',async()=>{
 let seen=[],revoked=[],now=0;
 const handler=createAccountAdminHandler({origin,keySha,revoked:id=>revoked.push(id),now:()=>now,lane:{async query(_,args){
   seen.push(args);
   const [action]=args;
   const result=action==='list'?{accounts:[]}:action==='preview'?{state:'preview',id,email,scope:'signup-only',canDelete:true}:{state:'deleted',id};
   return {rows:[{result}]};
 }}});
 const send=(v,key=token,from=origin)=>handler(new Request(origin+'/api/timeax/account-admin',{method:'POST',headers:{Origin:from,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(v)}));
 assert.equal((await send({action:'list',after:null},'no')).status,401);
 assert.equal((await send({action:'list',after:null},token,'https://elsewhere.test')).status,403);
 assert.equal((await send({action:'delete',id,email})).status,400);
 assert.equal(seen.length,0);
 const verification=await (await send({action:'preview',id})).json();
 assert.equal((await send({action:'delete',token:verification.token,email:'wrong@example.test'})).status,409);
 assert.equal((await send({action:'delete',token:verification.token,email})).status,200);
 assert.equal((await send({action:'delete',token:verification.token,email})).status,409);
 assert.deepEqual(revoked,[id]);
 assert.deepEqual(seen,[['preview',id,null],['delete',id,email]]);
 const second=await (await send({action:'preview',id})).json();
 now=120001;
 assert.equal((await send({action:'delete',token:second.token,email})).status,409);
});

test('account admin remains disabled unless independently configured',()=>{
 assert.equal(managedAccountAdmin({TIMEAX_ACCOUNT_ADMIN_KEY_SHA256:keySha}),null);
 assert.ok(managedAccountAdmin({TIMEAX_ACCOUNT_ADMIN_KEY_SHA256:keySha,TIMEAX_ACCOUNT_ADMIN_DB:token,TIMEAX_ACCOUNT_ADMIN_RPC_SHA256:keySha}));
});


test('owner overview and organization directory use scoped reads with bounded projections',async()=>{
 const calls=[];
 const summary={accounts:25,verifiedAccounts:22,agencies:4,factories:2,newAgencies30d:1};
 const organizations=Array.from({length:51},(_,i)=>({id:`33333333-3333-4333-8333-${String(i+100).padStart(12,'0')}`, name:'Fixture '+i,kind:'agency',state:'active',activeMembers:2,privateField:'not-for-response'}));
 const handler=createAccountAdminHandler({origin,keySha,revoked:()=>assert.fail('Read must not revoke a session'),lane:{
  async query(_,params){
   calls.push(params);
   const result=params[0]==='summary'?summary:params[0]==='organizations'?{organizations}:
    {accounts:[{id,email,createdAt:'2026-11-20T00:00:00Z',verified:true,privateField:'not-for-response'}]};
   return {rows:[{result}]};
  },
 }});
 const send=(v,key=token)=>handler(new Request(origin+'/api/timeax/account-admin',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(v)}));
 assert.equal((await send({action:'summary'},'wrong')).status,401);
 assert.equal((await send({action:'summary',after:null})).status,400);
 assert.equal((await send({action:'organizations',after:'bad-cursor'})).status,400);
 assert.equal((await send({action:'list',after:null,search:'x'.repeat(255)})).status,400);
 assert.equal(calls.length,0);
 assert.deepEqual(await (await send({action:'summary'})).json(),summary);
 const orgs=await (await send({action:'organizations',after:id})).json();
 assert.equal(orgs.organizations.length,50);
 assert.equal(orgs.next,organizations[49].id);
 assert.equal(Object.hasOwn(orgs.organizations[0],'privateField'),false);
 const accountList=await (await send({action:'list',after:null,search:'Fixture%'})).json();
 assert.equal(accountList.accounts.length,1);
 assert.equal(Object.hasOwn(accountList.accounts[0],'privateField'),false);
 assert.deepEqual(calls,[['summary',null,null],['organizations',id,null],['list',null,'Fixture%']]);
});

test('owner summary fails closed for impossible metrics',async()=>{
 const handler=createAccountAdminHandler({origin,keySha,revoked:()=>{},lane:{async query(){
  return {rows:[{result:{accounts:-1,verifiedAccounts:0,agencies:0,factories:0,newAgencies30d:0}}]};
 }}});
 const res=await handler(new Request(origin+'/api/timeax/account-admin',{method:'POST',
  headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'summary'})}));
 assert.equal(res.status,503);
 assert.equal(res.headers.get('Cache-Control'),'private, no-store');
});
