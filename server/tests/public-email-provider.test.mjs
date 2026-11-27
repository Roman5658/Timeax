import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPublicEmailProvider} from '../lib/public-email-provider.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const at=1764500000000,ts=Math.floor(at/1000);
const subject='91ab2f65-cee9-47c9-918b-a121efa2df4d',email='owner@example.test';
const syntheticToken=['mockHeader',Buffer.from(JSON.stringify({iss:ISSUER,sub:subject,
 session_id:'8cf59422-284b-4c84-912b-46f47e1c22bb',exp:ts+600,iat:ts-10,aud:'authenticated',
 role:'authenticated',is_anonymous:false,aal:'aal1'})).toString('base64url'),'mockSignature'].join('.');
const confirmed={id:subject,email,email_confirmed_at:new Date(at-1000).toISOString(),
 aud:'authenticated',role:'authenticated',is_anonymous:false};
function fixture(user=confirmed,{otpStatus=200}={}){
 const requests=[];
 const provider=createPublicEmailProvider({publishableKey:'sb_publishable_'+'a'.repeat(40),otpLength:8},{
  now:()=>at,async fetchImpl(url,init){
   requests.push({url,init});
   assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.ok(init.signal);
   assert.ok(url.startsWith(ISSUER+'/'));
   const response=url.endsWith('/otp')?new Response(null,{status:otpStatus}):
    (url.endsWith('/verify')||url.endsWith('/token?grant_type=password'))?Response.json({access_token:syntheticToken,refresh_token:'not-for-the-client'}):
    Response.json(user);
   Object.defineProperty(response,'url',{value:url});
   return response;
  }});
 return {requests,provider};
}
test('registration requests an OTP for each supplied email; login never creates accounts',async()=>{
 const {provider,requests}=fixture();
 assert.equal(await provider.requestCode(' OWNER@Example.test ','registration'),true);
 assert.equal(await provider.requestCode('other@example.test','login'),true);
 assert.deepEqual(requests.map(x=>JSON.parse(x.init.body)),[{email,create_user:true},{email:'other@example.test',create_user:false}]);
});
test('invalid input never calls the provider',async()=>{
 const {provider,requests}=fixture();
 assert.equal(await provider.requestCode('not-an-email','registration'),false);
 assert.equal(await provider.requestCode(email,'unexpected'),false);
 assert.equal(await provider.verifyCode(email,'123456'),null);
 assert.equal(requests.length,0);
});
test('receipt is identity only and must match the provider-confirmed address',async()=>{
 const {provider,requests}=fixture();
 assert.deepEqual(await provider.verifyCode(email,'12345678'),{issuer:ISSUER,subject,emailConfirmed:true,isAnonymous:false});
 assert.deepEqual(JSON.parse(requests[0].init.body),{email,token:'12345678',type:'email'});
 assert.equal(requests[1].init.headers.authorization,'Bearer '+syntheticToken);
 assert.equal(await provider.verifyCode('other@example.test','12345678'),null);
});
test('provider errors and ineligible accounts are not treated as authenticated',async()=>{
 assert.equal(await fixture(confirmed,{otpStatus:429}).provider.requestCode(email,'registration'),false);
 for(const user of [{...confirmed,is_anonymous:true},{...confirmed,email_confirmed_at:null},{...confirmed,banned_until:new Date(at+300000).toISOString()}]){
  assert.equal(await fixture(user).provider.verifyCode(email,'12345678'),null);
 }
});

test('password update can use only the internally retained verified enrollment session',async()=>{
 const {provider,requests}=fixture();
 const normal=await provider.verifyCode(email,'12345678');
 assert.equal(await provider.setPassword(normal,'example-long-password'),false);
 const enrollment=await provider.verifyCode(email,'12345678',{forPasswordSetup:true});
 assert.deepEqual(enrollment,normal);
 assert.equal(await provider.setPassword({...enrollment},'example-long-password'),false);
 assert.equal(await provider.setPassword(enrollment,'example-long-password'),true);
 assert.equal(await provider.setPassword(enrollment,'another-long-password'),false);
 const update=requests.filter(r=>r.init.method==='PUT');
 assert.equal(update.length,1);
 assert.equal(update[0].url,ISSUER+'/user');
 assert.equal(update[0].init.headers.authorization,'Bearer '+syntheticToken);
 assert.deepEqual(await provider.passwordLogin(email,'example-long-password'),normal);
});
