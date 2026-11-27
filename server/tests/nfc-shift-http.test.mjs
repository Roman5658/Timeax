import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {createNfcShiftGate} from '../lib/nfc-shift-gate.mjs';
import {createStationaryNfcHttpHandler,NFC_SHIFT_ENDPOINTS} from '../lib/nfc-shift-http.mjs';

const origin='https://timeax.example';
const id=n=>'5cc91000-04c5-40bb-ae1e-'+String(n).padStart(12,'0');
const assignment={mode:'nfc_stationary',agencyId:id(1),worksiteId:id(2),readerId:id(3),membershipId:id(4)};
const validKey='af'.repeat(32),testProof='v'.repeat(64);
const hash=value=>createHash('sha256').update(value).digest('hex');
const request=(where,body={},extra={})=>new Request(origin+(NFC_SHIFT_ENDPOINTS[where]??where),{
 method:'POST',body:JSON.stringify(body),headers:{Origin:origin,'Content-Type':'application/json','Sec-Fetch-Site':'same-origin'},...extra,
});
function fixture(){
 let active=true,current=Date.now(),punch,challenge,permission,verified=0;
 const ends=ttlMs=>new Date(current+ttlMs).toISOString();
 const store={
  async beginChallenge({challengeDigest,sessionBinding,ttlMs}){
   assert.equal(sessionBinding,Buffer.from(validKey,'hex').toString('base64url'));
   challenge={digest:challengeDigest,expiresAt:ends(ttlMs)};return challenge;
  },
  async readChallenge({challengeDigest}){
   return challenge?.digest===challengeDigest?challenge:null;
  },
  async authorize({challengeDigest,tokenDigest,tapReceipt,cardId,ttlMs}){
   assert.equal(challenge.digest,challengeDigest);assert.equal(cardId,id(5));assert.match(tapReceipt,/^[0-9a-f]{64}$/);
   challenge=null;permission={tokenDigest,action:punch==='started'?'end':'start',expiresAt:ends(ttlMs)};return permission;
  },
  async record({tokenDigest,action}){
   if(permission?.tokenDigest!==tokenDigest||permission?.action!==action||Date.parse(permission.expiresAt)<=current)return null;
   permission=null;punch=action==='start'?'started':'ended';return {state:punch};
  },
 };
 const gate=createNfcShiftGate({store,now:()=>current,verifyTap:async({scope,challengeDigest,proof})=>{
  verified++;assert.equal(scope.worksiteId,assignment.worksiteId);assert.equal(proof,testProof);
  return {authority:'authenticated-challenge',tapReceipt:hash('fixture/'+challengeDigest),challengeDigest,cardId:id(5)};
 }});
 const opts={
  origin,enabled:true,gate,now:()=>current,
  resolveSession:async()=>({state:'verified',issuer:ISSUER,expiresAt:current+60_000,isAnonymous:false,emailConfirmed:true,
   isActive:async()=>active,sessionKey:validKey,subject:id(6)}),
  scopeForWorker:async actor=>{assert.deepEqual(actor,{subject:id(6),issuer:ISSUER});return assignment},
 };
 return {opts,handle:createStationaryNfcHttpHandler(opts),elapse:ms=>{current+=ms},signOut:()=>{active=false},verificationCount:()=>verified};
}
const json=async(response,status)=>{
 assert.equal(response.status,status);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');return response.json();
};
test('from an active worker session, a new NFC challenge is required for both each start and each end',async()=>{
 const f=fixture();
 for(const [action,state] of [['start','started'],['end','ended']]){
  const prepared=await json(await f.handle(request('prepare')),200);
  assert.deepEqual(Object.keys(prepared),['challenge','expiresAt']);
  const offer=await json(await f.handle(request('proof',{challenge:prepared.challenge,deviceProof:testProof})),200);
  assert.deepEqual(Object.keys(offer),['token','action','expiresAt']);assert.equal(offer.action,action);
  assert.deepEqual(await json(await f.handle(request('record',{token:offer.token,action:offer.action})),200),{state});
 }
 assert.equal(f.verificationCount(),2);
});
test('disabled, logged out, unassigned and expired states do not offer or record an NFC shift',async()=>{
 const disabled=createStationaryNfcHttpHandler({origin});
 await json(await disabled(request('prepare')),503);
 assert.throws(()=>createStationaryNfcHttpHandler({origin,enabled:true}),/dependencies/);
 const first=fixture();
 first.signOut();await json(await first.handle(request('prepare')),401);
 const second=fixture();
 const denied=createStationaryNfcHttpHandler({...second.opts,scopeForWorker:async()=>null});
 await json(await denied(request('prepare')),403);
 const challenge=await json(await second.handle(request('prepare')),200);
 second.elapse(20_001);
 await json(await second.handle(request('proof',{challenge:challenge.challenge,deviceProof:testProof})),409);
 assert.equal(second.verificationCount(),0);
 const fresh=await json(await second.handle(request('prepare')),200);
 const grant=await json(await second.handle(request('proof',{challenge:fresh.challenge,deviceProof:testProof})),200);
 second.elapse(10_001);
 await json(await second.handle(request('record',{token:grant.token,action:grant.action})),409);
});
test('links and client choices are not an attendance path',async()=>{
 const {handle,verificationCount}=fixture();
 await json(await handle(new Request(origin+NFC_SHIFT_ENDPOINTS.prepare)),405);
 await json(await handle(request(NFC_SHIFT_ENDPOINTS.proof+'?tag=station')),404);
 await json(await handle(request('prepare',{membershipId:id(4)})),400);
 await json(await handle(request('record',{action:'start',token:'x'.repeat(43),time:'06:00'})),400);
 await json(await handle(request('prepare',{},{
  headers:{Origin:'https://other.example','Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},
 })),403);
 assert.equal(verificationCount(),0);
});
test('the handler does not serialize private details when a runtime is unavailable',async()=>{
 const f=fixture();
 const unavailable=createStationaryNfcHttpHandler({...f.opts,scopeForWorker:async()=>{throw Error('private infrastructure detail')}});
 assert.deepEqual(await json(await unavailable(request('prepare')),503),{error:'unavailable'});
});

test('the same site tag writes each enrolled worker only to their own shift record',async()=>{
 const now=Date.now(),challenges=new Map(),offers=new Map(),shifts=new Map();
 const expiresAt=ttlMs=>new Date(now+ttlMs).toISOString();
 const scopeKey=s=>[s.agencyId,s.worksiteId,s.readerId,s.membershipId,s.sessionBinding].join('/');
 const store={
  async beginChallenge(x){const r={scope:scopeKey(x),expiresAt:expiresAt(x.ttlMs)};challenges.set(x.challengeDigest,r);return r;},
  async readChallenge(x){const value=challenges.get(x.challengeDigest);return value?.scope===scopeKey(x)?value:null;},
  async authorize(x){
   if(x.cardId!==id(5)||!await this.readChallenge(x))return null;
   challenges.delete(x.challengeDigest);
   const r={scope:scopeKey(x),action:shifts.get(x.membershipId)==='started'?'end':'start',expiresAt:expiresAt(x.ttlMs)};
   offers.set(x.tokenDigest,r);return r;
  },
  async record(x){
   const r=offers.get(x.tokenDigest);
   if(!r||r.scope!==scopeKey(x)||r.action!==x.action)return null;
   offers.delete(x.tokenDigest);
   const state=x.action==='start'?'started':'ended';shifts.set(x.membershipId,state);return {state};
  },
 };
 const gate=createNfcShiftGate({store,now:()=>now,verifyTap:async({challengeDigest})=>({
  authority:'authenticated-challenge',tapReceipt:hash('same-tag/'+challengeDigest),challengeDigest,cardId:id(5)
 })});
 const make=account=>createStationaryNfcHttpHandler({origin,enabled:true,gate,now:()=>now,
  resolveSession:async()=>({state:'verified',issuer:ISSUER,expiresAt:now+60_000,isAnonymous:false,emailConfirmed:true,
   isActive:async()=>true,sessionKey:account.toString(16).padStart(64,'0'),subject:id(account)}),
  scopeForWorker:async({subject})=>subject===id(account)?{...assignment,membershipId:id(account+10)}:null,
 });
 const a=make(7),b=make(8);
 const prepared=await json(await a(request('prepare')),200);
 await json(await b(request('proof',{challenge:prepared.challenge,deviceProof:testProof})),409);
 const offer=await json(await a(request('proof',{challenge:prepared.challenge,deviceProof:testProof})),200);
 await json(await b(request('record',{token:offer.token,action:offer.action})),409);
 await json(await a(request('record',{token:offer.token,action:offer.action})),200);
 const second=await json(await b(request('prepare')),200);
 const secondOffer=await json(await b(request('proof',{challenge:second.challenge,deviceProof:testProof})),200);
 assert.equal(secondOffer.action,'start');
 await json(await b(request('record',{token:secondOffer.token,action:'start'})),200);
 assert.deepEqual([...shifts],[[id(17),'started'],[id(18),'started']]);
});
