import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationTransport,createRegistrationReviewTransport,isStagingRegistration} from '../src/modules/auth/registration/agency-registration.ts';
test('staging transport is explicit HTTPS, rejects public production and never enables the former fixture',()=>{
 const never=async()=>{throw Error('Unexpected request')};
 for(const [mode,origin] of [['production','https://staging.invalid'],['enrollment-staging','http://localhost'],['enrollment-staging','https://timeax.pl'],['enrollment-staging','https://www.timeax.pl'],['enrollment-staging','https://user:password@staging.invalid']]){
  assert.equal(isStagingRegistration(mode,origin),false);assert.equal(createRegistrationTransport(mode,origin,never),undefined);
 }
 assert.equal(isStagingRegistration('enrollment-staging','https://staging.invalid'),true);
 assert.equal(createRegistrationReviewTransport('enrollment-staging','https://staging.invalid',never),undefined);
});
test('staging client respects closed and anonymous server contexts without a POST',async()=>{
 for(const anonymous of [false,true]){
  const calls=[];
  const c=createRegistrationTransport('enrollment-staging','https://staging.invalid',async(url,init)=>{
   calls.push(init.method);const r=Response.json(anonymous?{version:1,state:'anonymous',capabilities:{login:false,verify:false,agencyRegistration:false,logout:false}}:{error:'unavailable'},
    {status:anonymous?200:503,headers:{'Cache-Control':'no-store'}});Object.defineProperty(r,'url',{value:url});return r;
  });
  assert.equal((await c.submit({agencyName:'Synthetic agency'},new AbortController().signal)).state,anonymous?'session':'unavailable');
  assert.deepEqual(calls,['GET']);
 }
});

test('registration distinguishes a rejected or expired email code from a service failure',async()=>{
 const {createWorkingRegistrationClient}=await import('../src/modules/auth/registration/contract/registration-client.ts');
 const make=(contextStatus,hasChallenge,verifyStatus)=>{
  let submissions=0;
  const c=createWorkingRegistrationClient('https://timeax.pl',async(url,init)=>{
   const post=init.method==='POST';if(post)submissions++;
   const value=post?{error:'verification-failed'}:{version:1,state:hasChallenge?'verification-required':'anonymous',otpLength:8,emailChallengeFlow:hasChallenge?'registration':undefined,capabilities:{login:true,verify:hasChallenge,agencyRegistration:false,logout:false}};
   const response=Response.json(value,{status:post?verifyStatus:contextStatus,headers:{'Cache-Control':'no-store, private'}});
   Object.defineProperty(response,'url',{value:url});return response;
  });
  return {check:()=>c.verifyCode('person@example.test','11111111',new AbortController().signal),sent:()=>submissions};
 };
 for(const [context,live,verify,expected,posts] of [[200,true,401,'invalid',1],[200,false,401,'invalid',0],[503,false,401,'unavailable',0],[200,true,503,'unavailable',1]]){
  const client=make(context,live,verify);assert.equal(await client.check(),expected);assert.equal(client.sent(),posts);
 }
});
