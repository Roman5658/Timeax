import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationReviewTransport, validateAgencyDraft, reviewOrigin} from '../src/modules/auth/registration/agency-registration.ts';

const receipt={requestId:'a3e3b0ac-797f-4522-8f48-1050cc849122',status:'pending',requestedAt:'2026-11-23T14:00:00.000Z'};
const verified={version:1,state:'verified',verified:true,serverTime:'2026-11-23T13:59:00.000Z',expiresAt:'2026-11-23T14:10:00.000Z',grants:[],
 capabilities:{login:false,verify:false,agencyRegistration:true,logout:false}};
function rig({context=verified,initial=null,postFailure=false,readbackFailure=false,badResponse=false,gate}={}){
 let saved=initial,posts=0;
 const calls=[];
 const transport=async(url,options)=>{
  calls.push({url,options});
  if(options.signal.aborted)throw new Error('aborted');
  let status=200,body;
  if(url.endsWith('/v1/session/context'))body=context;
  else if(options.method==='POST'){
   posts++;
   if(gate)await gate;
   saved=receipt;status=202;body={registration:receipt};
   if(postFailure)throw new Error('connection lost after commit');
  }else body={registration:readbackFailure&&posts?{...receipt,requestId:'invalid'}:saved};
  const response=new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':badResponse?'public':'no-store, private'}});
  Object.defineProperty(response,'url',{value:url});
  return response;
 };
 return {transport,calls,get posts(){return posts;},get saved(){return saved;}};
}
const signal=()=>new AbortController().signal;
const draft={agencyName:'Example Agency',nip:'1234567890'};
const client=r=>createRegistrationReviewTransport('registration-review',reviewOrigin,r.transport);

test('review transport is closed in regular builds and on every other origin',()=>{
 const r=rig();
 for(const [mode,origin] of [['production',reviewOrigin],['development',reviewOrigin],['registration-review','https://127.0.0.1:4173'],['registration-review','https://example.com'],['registration-review','http://127.0.0.1:43817']]){
  assert.equal(createRegistrationReviewTransport(mode,origin,r.transport),undefined);
 }
 assert.equal(r.calls.length,0);
});
test('agency validation preserves the archived contract and normalizes only allowed fields',()=>{
 assert.deepEqual(validateAgencyDraft(' Example Agency ','123-456-78-90').draft,draft);
 assert.deepEqual(validateAgencyDraft('Agency','').draft,{agencyName:'Agency'});
 for(const name of ['', 'A','a'.repeat(121),'Bad\u0000Name'])assert.equal(validateAgencyDraft(name,'').errors.name,true);
 for(const nip of ['123','123456789a','12345678901'])assert.equal(validateAgencyDraft('Agency',nip).errors.nip,true);
});
test('anonymous or missing registration capability cannot post a new application',async()=>{
 for(const context of [{version:1,state:'anonymous',capabilities:{login:true,verify:true,agencyRegistration:false,logout:false}}, {...verified,capabilities:{...verified.capabilities,agencyRegistration:false}}]){
  const r=rig({context});const result=await client(r).submit(draft,signal());
  assert.ok(['session','unavailable'].includes(result.state));assert.equal(r.posts,0);
 }
});
test('only an acknowledged and freshly read pending receipt confirms submission',async()=>{
 const r=rig(),c=client(r);assert.deepEqual(await c.check(signal()),{state:'none'});
 assert.deepEqual(await c.submit({...draft,role:'admin'},signal()),{state:'pending',registration:receipt});
 assert.equal(r.posts,1);
 const post=r.calls.find(c=>c.options.method==='POST');
 assert.deepEqual(JSON.parse(post.options.body),draft);
 for(const call of r.calls){assert.equal(call.options.redirect,'error');assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');}
 assert.deepEqual(await c.submit(draft,signal()),{state:'pending',registration:receipt});
 assert.equal(r.posts,1,'existing application is read rather than duplicated');
});
test('simultaneous submit and repeated click produce at most one POST',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const r=rig({gate}),c=client(r);
 const first=c.submit(draft,signal());assert.deepEqual(await c.submit(draft,signal()),{state:'busy'});
 release();assert.equal((await first).state,'pending');assert.equal(r.posts,1);
});
test('uncertain POST is not retried and explicit status check recovers its receipt',async()=>{
 const r=rig({postFailure:true}),c=client(r);
 assert.deepEqual(await c.submit(draft,signal()),{state:'uncertain'});assert.equal(r.posts,1);
 assert.deepEqual(await c.check(signal()),{state:'pending',registration:receipt});assert.equal(r.posts,1);
});
test('malformed readback, cacheable response and aborted request cannot claim success',async()=>{
 const r=rig({readbackFailure:true});assert.deepEqual(await client(r).submit(draft,signal()),{state:'uncertain'});
 const cached=rig({badResponse:true});assert.deepEqual(await client(cached).submit(draft,signal()),{state:'unavailable'});assert.equal(cached.posts,0);
 const stopped=rig(),abort=new AbortController();abort.abort();
 assert.equal((await client(stopped).submit(draft,abort.signal)).state,'unavailable');assert.equal(stopped.calls.length,0);
});
