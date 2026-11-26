import test from 'node:test';
import assert from 'node:assert/strict';
import {isLocalSessionResume,createRegistrationTransport} from '../src/modules/auth/registration/agency-registration.ts';
import {createWorkingRegistrationClient} from '../src/modules/auth/registration/contract/registration-client.ts';
test('existing-session UI is available only in its explicit local HTTPS build',()=>{
 assert.equal(isLocalSessionResume('pending-resume-local','https://127.0.0.1:45678'),true);
 for(const [mode,origin]of [['production','https://127.0.0.1:45678'],['pending-resume-local','http://127.0.0.1'],['pending-resume-local','https://staging.invalid'],['pending-resume-local','https://timeax.pl']]){
  assert.equal(isLocalSessionResume(mode,origin),false);assert.equal(createRegistrationTransport(mode,origin,async()=>{throw Error()}),undefined);
 }
});
test('existing login uses explicit same-origin endpoints and never submits a registration on status read',async()=>{
 const origin='https://127.0.0.1:45678',calls=[];
 const client=createWorkingRegistrationClient(origin,async(url,init)=>{
  calls.push({path:new URL(url).pathname,method:init.method});
  const r=Response.json({version:1,state:'anonymous',capabilities:{login:true,verify:false,agencyRegistration:false,logout:false}},{headers:{'Cache-Control':'no-store'}});
  Object.defineProperty(r,'url',{value:url});return r;
 },'existing');
 assert.equal((await client.registration(new AbortController().signal)).state,'session');
 assert.deepEqual(calls,[{path:'/v1/session/existing-context',method:'GET'}]);
});
