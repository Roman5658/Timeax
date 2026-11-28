import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPublicEmailRoutes} from '../lib/public-email-routes.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl',prefix=origin+'/api/timeax/auth/public/',reset='password-reset/',
 subject='91ab2f65-cee9-47c9-918b-a121efa2df4d',email='user@example.test',password='A valid new password 98';
const cookie=r=>r.headers.get('set-cookie')?.split(';')[0];
function fixture({available=true,saved=true,wrongEmail=false}={}){
 let at=1764500000000;
 const sent=[],verify=[],writes=[];
 const handler=createPublicEmailRoutes({origin,otpLength:8,tagKey:Buffer.alloc(32,42),now:()=>at,admitSend:async()=>true,
  provider:{
   async requestCode(address,flow){sent.push({address,flow});return available},
   async verifyCode(address,code,options){verify.push({address,options});return code==='12345678'?Object.freeze({email:wrongEmail?'other@example.test':address,subject,issuer:ISSUER,emailConfirmed:true,isAnonymous:false}):null},
   async setPassword(identity,newPassword){writes.push({identity,newPassword});return saved},
  },issueIdentitySession:async()=>{assert.fail('Password recovery cannot give a Timeax session')}});
 const call=(action,body,headers={})=>handler(new Request(prefix+action,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 async function proof(){
  const sent=await call(reset+'start',{email});const response=await call(reset+'verify',{code:'12345678'},{cookie:cookie(sent)});return {sent,response,proof:cookie(response)};
 }
 return {call,proof,sent,verify,writes,tick:ms=>{at+=ms}};
}
test('reset uses existing-account OTP, rotates a browser proof and does not issue any application session',async()=>{
 const f=fixture();
 const start=await f.call(reset+'start',{email});
 assert.equal(start.status,202);
 assert.deepEqual(f.sent,[{address:email,flow:'login'}]);
 assert.match(start.headers.get('set-cookie'),/^__Host-timeax-reset-challenge=.*; Secure; HttpOnly; SameSite=Strict$/);
 assert.equal((await f.call(reset+'complete',{password},{cookie:cookie(start)})).status,401);
 assert.equal((await f.call(reset+'verify',{code:'12345678'})).status,401);
 const wrongLane=cookie(start).replace('__Host-timeax-reset-challenge','__Host-timeax-email-challenge');
 assert.equal((await f.call('verify',{code:'12345678'},{cookie:wrongLane})).status,401);
 const verified=await f.call(reset+'verify',{code:'12345678'},{cookie:cookie(start)});
 assert.equal(verified.status,200);assert.equal(verified.headers.getSetCookie().length,1);
 assert.deepEqual(f.verify,[{address:email,options:{forPasswordSetup:true}}]);
 const proof=cookie(verified);assert.notEqual(proof,cookie(start));assert.match(proof,/^__Host-timeax-reset-challenge=/);
 assert.equal((await f.call(reset+'complete',{password:'short'},{cookie:proof})).status,400);
 const results=await Promise.all([f.call(reset+'complete',{password},{cookie:proof}),f.call(reset+'complete',{password},{cookie:proof})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
 const ok=results.find(r=>r.ok);assert.deepEqual(await ok.json(),{status:'password-reset'});
 assert.match(ok.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].identity.subject,subject);
});
test('a missing account is acknowledged generically without delivering a reset proof',async()=>{
 const f=fixture({available:false});const response=await f.call(reset+'start',{email});
 assert.equal(response.status,202);assert.deepEqual(await response.json(),{status:'accepted'});
 assert.equal((await f.call(reset+'verify',{code:'12345678'},{cookie:cookie(response)})).status,401);
 assert.deepEqual(f.writes,[]);
});
test('wrong email projection, expired, cancelled and failed writes never produce a usable reset',async()=>{
 assert.equal((await fixture({wrongEmail:true}).proof()).response.status,401);
 const expired=fixture();const x=await expired.proof();expired.tick(300001);
 assert.equal((await expired.call(reset+'complete',{password},{cookie:x.proof})).status,401);
 const cancelled=fixture();const y=await cancelled.proof();assert.equal((await cancelled.call(reset+'cancel',{}, {cookie:y.proof})).status,200);
 assert.equal((await cancelled.call(reset+'complete',{password},{cookie:y.proof})).status,401);
 const fault=fixture({saved:false});const z=await fault.proof();
 assert.equal((await fault.call(reset+'complete',{password},{cookie:z.proof,origin:'https://untrusted.test'})).status,403);
 assert.equal((await fault.call(reset+'complete',{password},{cookie:z.proof})).status,409);
 assert.equal((await fault.call(reset+'complete',{password},{cookie:z.proof})).status,401);
 assert.equal(fault.writes.length,1);
});
