import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {createPayEstimateHandler,validPayEstimateSetting} from '../lib/pay-estimates.server.mjs';

const origin='https://timeax.pl',org='11111111-1111-4111-8111-111111111111',worker='22222222-2222-4222-8222-222222222222';
const row={workerId:worker,effectiveMonth:'2026-11',basis:'gross',rateCents:3000,deductions:[{name:'PIT',cents:10000}],revision:0};
const req=(input,from=origin)=>new Request(origin+'/api/pay-estimates/'+org+'/'+(input?'set':'context'),input?{
 method:'POST',headers:{origin:from,'Content-Type':'application/json'},body:JSON.stringify(input)
}:{});
test('estimate inputs separate gross and net; reject hidden deductions, bad month and foreign authority fields',()=>{
 assert.ok(validPayEstimateSetting(row));
 assert.ok(validPayEstimateSetting({...row,basis:'net',deductions:[]}));
 for(const entry of [{...row,basis:'net'}, {...row,effectiveMonth:'2026-00'}, {...row,rateCents:1000001},
  {...row,deductions:[{name:' two ',cents:10}]}, {...row,deductions:[{name:'PIT',cents:1000000000},{name:'Other',cents:1}]},
  {...row,organizationId:org}])assert.equal(validPayEstimateSetting(entry),false);
});
test('estimate endpoint returns only the exact receipt and fails closed for unverified or external requests',async()=>{
 const seen=[];
 let result={...row,revision:1},allowed=true;
 const resolveSession=async()=>allowed?{issuer:ISSUER,subject:'actor',state:'verified',emailConfirmed:true,isAnonymous:false,expiresAt:10,isActive:async()=>true}:{state:'anonymous'};
 const handler=createPayEstimateHandler({origin,now:()=>0,resolveSession,store:{invoke:async(s,a,b)=>{seen.push([s.subject,a,b]);return result}}});
 assert.equal((await handler(req(row,'https://offsite.example'))).status,403);
 assert.equal((await handler(req({...row,workerId:'foreign'}))).status,400);
 assert.deepEqual(seen,[]);
 const saved=await handler(req(row));
 assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store, private');
 assert.deepEqual(await saved.json(),result);assert.deepEqual(seen,[['actor','set',{...row,organizationId:org}]]);
 result={...result,revision:10};assert.equal((await handler(req(row))).status,503);
 result={organizationId:worker,settings:[]};assert.equal((await handler(req())).status,503);
 result={organizationId:org,settings:[{...row,revision:1}]};assert.equal((await handler(req())).status,200);
 allowed=false;assert.equal((await handler(req())).status,401);
});
