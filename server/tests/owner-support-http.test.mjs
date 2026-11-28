import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAccountAdminHandler,managedAccountAdmin,ACCOUNT_SUPPORT_SQL} from '../lib/account-admin.mjs';
const origin='https://timeax.pl',key='x'.repeat(64),hash=createHash('sha256').update(key).digest('hex'),accountId='12345678-1234-4234-8234-123456789001',id='12345678-1234-4234-8234-123456789002';

function fixture(enabled=true){
 const calls=[],state={revision:2},revocations=[];
 const h=createAccountAdminHandler({origin,keySha:hash,revoked:(...v)=>revocations.push(v),
  lane:{query:async()=>{assert.fail('support must not use existing admin SQL role')}},
  supportLane:enabled?{async query(sql,args){
   assert.equal(sql,ACCOUNT_SUPPORT_SQL);const [a,who,body]=args;const payload=JSON.parse(body);calls.push([a,who,payload]);
   const result=a==='account'?{state:'ready',account:{id:who,email:'user@example.test',verified:true,memberships:[{id,role:'worker',untrusted:'no'}],encrypted_password:'never'}}:
    a==='audit'?{state:'ready',events:[{id,action:'correct-shift',reason:'Fixed 1 hour',before:{start:'06:00',passwordHash:'never'},after:{end:'14:00',token:'never'}}]}:
    a==='shifts'?{state:'ready',shifts:[{id,source:'agency',start:'06:00',end:'14:00',revision:state.revision,privateExtra:'never'}],truncated:false}:
    a==='correct-shift'?(payload.revision===state.revision?{state:'corrected',id}:{state:'changed'}):{state:'revoked',id:who};
   return {rows:[{result}]};
  }}:null});
 const call=(body,headers={})=>h(new Request(origin+'/api/timeax/account-admin',{method:'POST',headers:{origin,authorization:'Bearer '+key,'content-type':'application/json',...headers},body:JSON.stringify({accountId,...body})}));
 return {call,calls,revocations};
}
test('owner support validates input and uses a separate lane behind the owner key',async()=>{
 const {call,calls}=fixture();
 assert.equal((await call({action:'support-account'},{authorization:'Bearer '+'y'.repeat(64)})).status,401);
 assert.equal((await call({action:'support-account'},{origin:'https://other.test'})).status,403);
 assert.equal((await call({action:'support-shifts',from:'2026-02-30',to:'2026-03-01'})).status,400);
 assert.equal((await call({action:'support-shifts',from:'2026-01-01',to:'2026-02-01'})).status,400);
 assert.equal((await call({action:'support-revoke-sessions',reason:'a'})).status,400);
 assert.equal((await call({action:'support-account',includeSecrets:true})).status,400);
 assert.deepEqual(calls,[]);
 assert.equal((await fixture(false).call({action:'support-account'})).status,503);
});
test('support response never forwards additional credential or audit properties',async()=>{
 const {call,calls}=fixture();
 const account=await (await call({action:'support-account'})).json();
 assert.equal(account.account.id,accountId);
 assert.equal('encrypted_password' in account.account,false);
 assert.equal('untrusted' in account.account.memberships[0],false);
 const shifts=await (await call({action:'support-shifts',from:'2026-01-01',to:'2026-01-31'})).json();
 assert.equal('privateExtra' in shifts.shifts[0],false);
 const audit=await (await call({action:'support-audit'})).json();
 assert.deepEqual(audit.events[0].before,{start:'06:00'});
 assert.deepEqual(audit.events[0].after,{end:'14:00'});
 assert.deepEqual(calls[1],['shifts',accountId,{from:'2026-01-01',to:'2026-01-31'}]);
});
test('owner corrections carry a revision and reason; session revoke does not delete an account',async()=>{
 const {call,revocations}=fixture();
 const update={action:'support-correct-shift',id,revision:2,source:'agency',start:'06:00',end:'14:00',reason:'Corrected a date error'};
 assert.equal((await call({...update,revision:1})).status,409);
 assert.equal((await call(update)).status,200);
 assert.deepEqual(revocations,[]);
 assert.equal((await call({action:'support-revoke-sessions',reason:'User reported stolen phone'})).status,200);
 assert.deepEqual(revocations,[[accountId,'sessions']]);
});
test('support setup never requires changing old owner configuration or reusing its password',()=>{
 const base={TIMEAX_ACCOUNT_ADMIN_KEY_SHA256:hash,TIMEAX_ACCOUNT_ADMIN_DB:key,TIMEAX_ACCOUNT_ADMIN_RPC_SHA256:hash};
 assert.equal(managedAccountAdmin(base).support,undefined);
 assert.equal(managedAccountAdmin({...base,TIMEAX_OWNER_SUPPORT_DB:key,TIMEAX_OWNER_SUPPORT_RPC_SHA256:hash}).support,undefined);
 assert.equal(managedAccountAdmin({...base,TIMEAX_OWNER_SUPPORT_DB:'z'.repeat(64),TIMEAX_OWNER_SUPPORT_RPC_SHA256:hash}).support.sha,hash);
});
