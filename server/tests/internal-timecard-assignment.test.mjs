import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {createTimecardsHandler} from '../lib/timecards.server.mjs';

const id=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const origin='https://timeax.example',org=id(1),member=id(2),site=id(3),assignmentStart='2026-11-27T15:34:18.477Z';
const request=(localDate,startTime,endTime)=>new Request(origin+'/api/timecards/'+org+'/create',{
 method:'POST',headers:{origin,'Content-Type':'application/json'},
 body:JSON.stringify({operationId:id(4),localDate,startTime,endTime,breakStatus:'not-reported',breakMinutes:0,breakTreatment:'unpaid',comment:''})
});

test('internal worker with manual access gets a clear assignment-period error, and a shift after assignment still saves',async()=>{
 const writes=[];
 const session={state:'verified',issuer:ISSUER,subject:id(5),emailConfirmed:true,isAnonymous:false,expiresAt:1,workspaceRole:'worker',workspaceMembershipId:member,workspaceWorksites:[site],isActive:async()=>true};
 const handler=createTimecardsHandler({origin,now:()=>0,resolveSession:async()=>session,store:{async invoke(_actor,action,input){
  if(action==='context')return {organizationId:org,membershipId:member,role:'worker',worksites:[{id:site,manualEntry:true}]};
  assert.equal(action,'create');assert.equal(input.worksiteId,site);
  if(input.data.startAt<assignmentStart)throw Object.assign(Error('Active assignment required'),{code:'42501'});
  if(input.data.localDate==='2026-11-29')throw Object.assign(Error('Internal manual entry is not enabled'),{code:'42501'});
  writes.push(input.data);return {id:id(6),revision:1,saved:true};
 }}});
 const outside=await handler(request('2026-11-27','06:00','14:00'));
 assert.equal(outside.status,409);assert.deepEqual(await outside.json(),{error:'outside-assignment-period'});
 assert.equal(writes.length,0);
 const inside=await handler(request('2026-11-28','06:00','14:00'));
 assert.equal(inside.status,200);assert.deepEqual(await inside.json(),{id:id(6),revision:1,saved:true});
 assert.equal(writes[0].startAt,'2026-11-28T05:00:00.000Z');assert.equal(writes[0].paidMinutes,480);
 const denied=await handler(request('2026-11-29','06:00','14:00'));
 assert.equal(denied.status,403);assert.deepEqual(await denied.json(),{error:'denied'});
 assert.equal(writes.length,1);
});

test('worker earlier shift receipt reports a pending request, not a saved timecard',async()=>{
 const session={state:'verified',issuer:ISSUER,subject:id(5),emailConfirmed:true,isAnonymous:false,expiresAt:1,workspaceRole:'worker',workspaceMembershipId:member,workspaceWorksites:[site],isActive:async()=>true};
 const handler=createTimecardsHandler({origin,now:()=>0,resolveSession:async()=>session,store:{async invoke(_actor,action){
  if(action==='context')return {organizationId:org,membershipId:member,role:'worker',worksites:[{id:site,manualEntry:true}]};
  assert.equal(action,'create');return {id:id(6),state:'pending',ignored:'private'};
 }}});
 const r=await handler(request('2026-11-27','06:00','14:00'));
 assert.equal(r.status,202);assert.deepEqual(await r.json(),{id:id(6),state:'pending'});
 for(const action of ['backdated-list','earlier-list']){
  const r=await handler(new Request(origin+'/api/timecards/'+org+'/'+action));
  assert.equal(r.status,403);
 }
});
