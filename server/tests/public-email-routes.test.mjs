import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPublicEmailRoutes} from '../lib/public-email-routes.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl',url=origin+'/api/timeax/auth/public/';
const id='91ab2f65-cee9-47c9-918b-a121efa2df4d';
function setup({admit=true,available=true}={}){
 let at=1764500000000;
 const sends=[],checks=[],sessions=[];
 const routes=createPublicEmailRoutes({origin,otpLength:8,tagKey:Buffer.alloc(32,3),now:()=>at,
  admitSend:async()=>admit,
  provider:{
   async requestCode(email,flow){sends.push([email,flow]);return available},
   async verifyCode(email,code){checks.push(email);return code==='12345678'?{issuer:ISSUER,subject:id,emailConfirmed:true,isAnonymous:false}:null}
  },
  async issueIdentitySession(identity){sessions.push(identity);return {id:'x'.repeat(43),maxAge:300}}
 });
 const call=(path,body,headers={})=>routes(new Request(url+path,{method:'POST',
  headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 return {sends,checks,sessions,call,tick:ms=>{at+=ms}};
}
test('code verification is tied to the same browser challenge and creates only an identity session',async()=>{
 const {call,sends,checks,sessions}=setup();
 const sent=await call('start',{email:'Owner@example.test',flow:'registration'});
 assert.equal(sent.status,202);assert.deepEqual(sends,[['owner@example.test','registration']]);
 assert.match(sent.headers.get('set-cookie'),/Path=\/; Secure; HttpOnly; SameSite=Strict/);
 const cookie=sent.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('verify',{code:'12345678'})).status,401);
 const verified=await call('verify',{code:'12345678'},{cookie});
 assert.equal(verified.status,200);assert.deepEqual(await verified.json(),{status:'email-verified'});
 assert.equal(verified.headers.getSetCookie().length,2);
 assert.equal((await call('verify',{code:'12345678'},{cookie})).status,401);
 assert.deepEqual(checks,['owner@example.test']);assert.deepEqual(sessions,[{issuer:ISSUER,subject:id,emailConfirmed:true,isAnonymous:false,flow:'registration'}]);
});
test('only same-origin valid requests passing send admission may reach the provider',async()=>{
 const {call,sends}=setup({admit:false});
 const body={email:'owner@example.test',flow:'login'};
 assert.equal((await call('start',body,{origin:'https://example.test'})).status,403);
 assert.equal((await call('start',{...body,role:'owner'})).status,400);
 assert.equal((await call('start',body)).status,429);
 assert.deepEqual(sends,[]);
});
test('a denied delivery gives a neutral response and fulfils no identity request',async()=>{
 const {call,checks,sessions}=setup({available:false});
 const sent=await call('start',{email:'owner@example.test',flow:'login'});
 assert.equal(sent.status,202);assert.deepEqual(await sent.json(),{status:'accepted'});
 const cookie=sent.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('verify',{code:'12345678'},{cookie})).status,401);
 assert.equal(checks.length,0);assert.equal(sessions.length,0);
});
test('challenge attempts, expiry and duplicate sends are bounded',async()=>{
 const {call,checks,sends,tick}=setup();
 const input={email:'owner@example.test',flow:'login'};
 const sent=await call('start',input),cookie=sent.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('start',input)).status,202);assert.equal(sends.length,1);
 for(let index=0;index<6;index++)assert.equal((await call('verify',{code:'99999999'},{cookie})).status,401);
 assert.equal(checks.length,5);
 tick(61_000);
 const next=await call('start',input),later=next.headers.get('set-cookie').split(';')[0];
 tick(300_000);
 assert.equal((await call('verify',{code:'12345678'},{cookie:later})).status,401);
 assert.equal(checks.length,5);
});
