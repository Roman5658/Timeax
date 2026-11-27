import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgencyOperations} from '../lib/agency-operations.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl',root='/api/personal-account/',id='91ab2f65-cee9-47c9-918b-a121efa2df4d',email='worker@example.test';
const own={state:'active',identityId:id,memberships:[],timecards:[],payslips:[],exportVersion:1};
const request=(action,opts={})=>new Request(origin+root+action,{method:opts.method??'GET',
 headers:{cookie:'fixture=identity; __Host-timeax-account-deletion-intent='+'A'.repeat(43),origin,...opts.headers}});

function fixture({session='verified',allowed=true,active=true}={}){
 const calls=[];
 const ops=assembleAgencyOperations({origin,selfService:true,workspaceReadPassword:'w'.repeat(43),
  agencyOperations:{account:{password:'a'.repeat(43),hashes:{'timeax_api.account_lifecycle(text,text,text,jsonb)':'1'.repeat(64)}}}},
  ({role})=>({async preflight(){},async query(_query,args){
   assert.equal(role,'timeax_account_login');
   assert.deepEqual(args,[ISSUER,id,args[2],'{}']);
   calls.push(args[2]);
   if(!allowed)throw Object.assign(Error('Own worker only'),{code:'42501'});
   return {rows:[{value:own}]};
  }}),{now:()=>1}).then(bind=>bind(async()=>session==='verified'?
   {state:'verified',issuer:ISSUER,subject:id,email,emailConfirmed:true,isAnonymous:false,expiresAt:500,isActive:async()=>active}:
   {state:session}));
 return {ops,calls};
}

test('hosted worker profile and export expose only the pinned actor-scoped archive',async()=>{
 const {ops,calls}=fixture(),routes=await ops;
 const profile=await routes.find(root+'context')(request('context'));
 assert.equal(profile.status,200);
 assert.equal(profile.headers.get('cache-control'),'no-store, private');
 assert.deepEqual(await profile.json(),{...own,email,deletionAvailable:false,deletionState:'none'});
 const archive=await routes.find(root+'export')(request('export'));
 assert.equal(archive.status,200);
 assert.deepEqual(await archive.json(),own);
 assert.deepEqual(calls,['context','export']); // no deletion intent lookup in hosted read-only mode
 for(const action of ['begin-delete','delete','deletion-status','recovery-request'])
  assert.equal(routes.find(root+action),undefined);
 assert.equal((await routes.find(root+'context')(request('context',{method:'POST'}))).status,405);
});

test('profile rejects missing/stale sessions and preserves worker-only DB boundaries',async()=>{
 for(const [opts,code,writes] of [[{session:'anonymous'},401,[]],[{active:false},401,[]],[{allowed:false},403,['context']]]){
  const f=fixture(opts),routes=await f.ops;
  assert.equal((await routes.find(root+'context')(request('context'))).status,code);
  assert.deepEqual(f.calls,writes);
 }
});
