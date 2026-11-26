import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Webhook} from 'standardwebhooks';
import {createPublicSignupHook} from '../lib/public-signup-hook.mjs';
import {createProviderWebhookVerifier,ISSUER} from '../lib/provider-adapters.mjs';
import {createPublicEmailProvider} from '../lib/public-email-provider.mjs';

const origin='https://timeax.pl',email='two@example.test';
const projectKey='sb_publishable_'+'b'.repeat(40);
const bytes=Buffer.alloc(32,11).toString('base64'), signer=new Webhook('whsec_'+bytes);
const hook=createPublicSignupHook({origin,verifyWebhook:createProviderWebhookVerifier('whsec_'+bytes)});
function callback(data,address=email,{sign=true,provider='email',age=0}={}){
 const now=new Date(),id='8cf59422-284b-4c84-912b-46f47e1c22bb';
 const body=JSON.stringify({metadata:{name:'before-user-created',uuid:id,time:new Date(+now-age).toISOString()},
  user:{id:'91ab2f65-cee9-47c9-918b-a121efa2df4d',aud:'authenticated',role:'',email:address,phone:'',is_anonymous:false,
   app_metadata:{provider,providers:[provider]},user_metadata:data}});
 const headers={"content-type":"application/json",'webhook-id':id,'webhook-timestamp':String(Math.floor(+now/1000)),'webhook-signature':sign?signer.sign(id,now,body):'v1,invalid'};
 return hook.handler(new Request(origin+'/hooks/before-user-created',{method:'POST',body,headers}));
}
test('the signed signup callback accepts one recipient-bound server intent and does not grant a role',async()=>{
 assert.equal((await callback(undefined)).status,403);
 await hook.withRegistrationIntent(email,async data=>{
  assert.equal((await callback(data,email,{sign:false})).status,403);
  assert.equal((await callback(data,'other@example.test')).status,403);
  assert.equal((await callback(data,email,{provider:'google'})).status,403);
  assert.equal((await callback(data,email,{age:60_000})).status,403);
  const allow=await callback(data);
  assert.equal(allow.status,200);
  assert.deepEqual(await allow.json(),{});
  assert.equal((await callback(data)).status,403);
 });
 let expired;
 await hook.withRegistrationIntent(email,async data=>{expired=data;return false});
 assert.equal((await callback(expired)).status,403);
});
test('the provider sends an intent only for registration; both paths still use email OTP',async()=>{
 const seen=[];
 const provider=createPublicEmailProvider({publishableKey:projectKey,otpLength:8,signupIntent:hook.withRegistrationIntent},{
  async fetchImpl(url,init){
   assert.equal(url,ISSUER+'/otp');
   const p=JSON.parse(init.body);seen.push({email:p.email,createUser:p.create_user});
   if(p.create_user)assert.equal((await callback(p.data,p.email)).status,200);
   else assert.equal(p.data,undefined);
   const response=new Response(null,{status:200});Object.defineProperty(response,'url',{value:url});return response;
  }
 });
 assert.equal(await provider.requestCode(email,'registration'),true);
 assert.equal(await provider.requestCode('second@example.test','registration'),true);
 assert.equal(await provider.requestCode(email,'login'),true);
 assert.deepEqual(seen,[{email,createUser:true},{email:'second@example.test',createUser:true},{email,createUser:false}]);
});
