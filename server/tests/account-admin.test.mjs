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
