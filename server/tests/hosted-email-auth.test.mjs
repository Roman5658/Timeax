import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Webhook} from 'standardwebhooks';
import {assembleHostedEmailAuth,createHourlySendBudget} from '../lib/hosted-email-auth.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl',webhookSecret='whsec_'+Buffer.alloc(32,7).toString('base64');
const config={mode:'public-email-v1',instances:1,origin,webhookSecret,key:'sb_publishable_'+'a'.repeat(40),otpLength:8,
 host:'db.example.test',ca:'fixture',password:'fixture',registrationSha:'a'.repeat(64),statusSha:'b'.repeat(64),hourlyEmailBudget:10};
const laneFactory=options=>{
 assert.equal(options.role,'timeax_pending_registration_login');
 assert.equal(options.functions.length,2);
 return {preflight:async()=>{},query:async()=>{throw Error('not in this test')}};
};
test('canonical registration composes the provider and signed callback in the same runtime',async()=>{
 const signer=new Webhook(webhookSecret),seen=[];
 async function fetchImpl(url,{body}){
  assert.equal(url,ISSUER+'/otp');
  const p=JSON.parse(body);seen.push(p.email);
  const at=new Date(),id='8cf59422-284b-4c84-912b-46f47e1c22bb';
  const raw=JSON.stringify({metadata:{name:'before-user-created',uuid:id,time:at.toISOString()},
   user:{id,aud:'authenticated',role:'authenticated',email:p.email,is_anonymous:false,
    app_metadata:{provider:'email',providers:['email']},user_metadata:p.data}});
  const hookRequest=()=>new Request(origin+'/hooks/before-user-created',{method:'POST',body:raw,headers:{
   'webhook-id':id,'webhook-timestamp':String(Math.floor(+at/1000)),'webhook-signature':signer.sign(id,at,raw)}});
  assert.equal((await runtime.handler(hookRequest())).status,200);
  assert.equal((await runtime.handler(hookRequest())).status,403);
  return Object.defineProperty(new Response(null,{status:200}),'url',{value:url});
 }
 const runtime=await assembleHostedEmailAuth(config,{fetchImpl,laneFactory});
 const start=email=>runtime.handler(new Request(origin+'/api/timeax/auth/public/start',{method:'POST',
  headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({email,flow:'registration'})}));
 for(const name of ['one','two']){
  const response=await start(name+'@example.test');
  assert.equal(response.status,202);
  assert.match(response.headers.get('Set-Cookie'),/^__Host-timeax-email-challenge=.*; Secure; HttpOnly; SameSite=Strict$/);
 }
 assert.deepEqual(seen,['one@example.test','two@example.test']);
});
test('assembly denies unsupported deployment and database preflight failures',async()=>{
 await assert.rejects(assembleHostedEmailAuth({...config,instances:2},{laneFactory}),/explicit canonical/);
 await assert.rejects(assembleHostedEmailAuth({...config,origin:'http://127.0.0.1:5173'},{laneFactory}),/explicit canonical/);
 await assert.rejects(assembleHostedEmailAuth(config,{laneFactory:()=>({preflight:async()=>{throw Error('database denied')}})}),/database denied/);
});
test('the admission budget expires rather than accumulating indefinitely',()=>{
 let at=1000;const take=createHourlySendBudget(2,()=>at);
 assert.equal(take(),true);assert.equal(take(),true);assert.equal(take(),false);
 at+=3_600_000;assert.equal(take(),true);
});
