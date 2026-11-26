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
