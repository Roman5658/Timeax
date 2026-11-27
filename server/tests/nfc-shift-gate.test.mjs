import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNfcShiftGate,permitsTimeRecording,TIME_RECORDING_MODES} from '../lib/nfc-shift-gate.mjs';

const uid=n=>'11234567-1234-4000-8000-'+String(n).padStart(12,'0');
const terminal={mode:'nfc_terminal',agencyId:uid(1),worksiteId:uid(2),readerId:uid(4),sessionBinding:'a'.repeat(43)};
const stationary={...terminal,mode:'nfc_stationary',readerId:uid(5),membershipId:uid(3)};
const hash=v=>createHash('sha256').update(v).digest('hex');
const sameScope=(x,y)=>x&&['mode','agencyId','worksiteId','readerId','membershipId','sessionBinding'].every(k=>x[k]===y[k]);

// Pure synchronous operations inside each fake method model a transaction.
// This is a contract test, not a claim that a production DB implements it.
function fixture(){
 let now=Date.parse('2026-11-27T13:00:00Z'), enabled=true, reader=true, active=true;
 let verified=0;
 const challenges=new Map(),offers=new Map(),taps=new Set(),windowRevisions=new Map(),writes=[];
 const members=new Map([[uid(6),{...terminal,membershipId:uid(9)}],[uid(7),{...stationary}]]);
 const expiresAt=ttl=>new Date(now+ttl).toISOString();
 const open=entry=>entry&&Date.parse(entry.expiresAt)>now;
 const scopeReady=()=>enabled&&reader&&active;
 const matchingCard=(scope,card)=>{
  const binding=members.get(card);
  if(!binding)return;
  const member=binding.membershipId;
  if(scope.mode==='nfc_terminal'){const {membershipId,...readerScope}=binding;if(sameScope(scope,readerScope))return member;}
  else if(sameScope(scope,binding))return member;
 };
 const gate=createNfcShiftGate({
  now:()=>now,
  verifyTap:async({scope,challenge,challengeDigest,proof})=>{
   verified++;
   assert.equal(challengeDigest,hash(challenge));
   assert.equal(Object.isFrozen(scope),true);
   if(proof?.marker!=='trusted-test-fixture')return null;
   return {authority:proof.authority??'authenticated-challenge',tapReceipt:proof.tapReceipt??hash(challenge+'-test-receipt'),challengeDigest:proof.challengeDigest??challengeDigest,cardId:proof.cardId};
  },
  store:{
   async beginChallenge(s){
    if(!scopeReady())return null;
    const row={...s,expiresAt:expiresAt(s.ttlMs)};
    assert.ok(!Object.hasOwn(s,'challenge'));
    challenges.set(s.challengeDigest,row);
    return row;
   },
   async readChallenge(s){
    const row=challenges.get(s.challengeDigest);
    return open(row)&&sameScope(s,row)&&scopeReady()?row:null;
   },
   async authorize(s){
    const row=challenges.get(s.challengeDigest),member=matchingCard(s,s.cardId);
    if(!scopeReady()||!open(row)||!sameScope(s,row)||!member||taps.has(s.tapReceipt))return null;
    // Under DB lock, read mutable shift version, consume challenge and tap,
    // then issue exactly one expected action for the worker.
    challenges.delete(s.challengeDigest);
    taps.add(s.tapReceipt);
    assert.ok(!Object.hasOwn(s,'proof')&&!Object.hasOwn(s,'token'));
    const shiftKey=[s.agencyId,s.worksiteId,member].join('/'),version=windowRevisions.get(shiftKey)??0;
    const next={...s,shiftKey,version,action:version%2?'end':'start',expiresAt:expiresAt(s.ttlMs)};
    offers.set(s.tokenDigest,next);
    return {...next,hiddenMembershipId:member}; // Gate must never forward this.
   },
   async record(s){
    const row=offers.get(s.tokenDigest);
    if(!scopeReady()||!open(row)||!sameScope(s,row)||s.action!==row.action||
       (windowRevisions.get(row.shiftKey)??0)!==row.version||!matchingCard(s,row.cardId))return null;
    offers.delete(s.tokenDigest);
    windowRevisions.set(row.shiftKey,row.version+1);
    writes.push({shiftKey:row.shiftKey,mode:s.mode,action:s.action,at:now});
    return {state:s.action==='start'?'started':'ended',internalRow:row};
   },
  },
 });
 return {gate,challenges,offers,writes,verified:()=>verified,advance:n=>now+=n,
  disableMode:()=>enabled=false,revokeReader:()=>reader=false,endAssignment:()=>active=false};
}
const proof=cardId=>({marker:'trusted-test-fixture',cardId});
async function tap(gate,scope,cardId){
 const start=await gate.begin(scope);assert.ok(start?.challenge);
 return gate.authorize(scope,start.challenge,proof(cardId));
}

test('effective settings distinguish channels and never treat unset mode as an active grant',()=>{
 for(const mode of TIME_RECORDING_MODES)for(const channel of TIME_RECORDING_MODES)assert.equal(permitsTimeRecording(mode,channel),mode===channel);
 assert.equal(permitsTimeRecording(null,'manual'),false);
 assert.throws(()=>createNfcShiftGate({}));
});

test('stationary tap requires signed-in membership; terminal starts without picking a worker',async()=>{
 const {gate}=fixture();
 const {membershipId,...unbound}=stationary;
 assert.equal(await gate.begin(unbound),null);
 assert.equal(await gate.begin({...terminal,membershipId}),null);
 assert.equal(await gate.begin({...terminal,action:'start'}),null);
 assert.ok(await gate.begin(terminal));
 const stationaryOffer=await tap(gate,stationary,uid(7));
 assert.equal(stationaryOffer.action,'start');
 assert.equal(await gate.record({...stationary,membershipId:uid(99)},stationaryOffer.token,'start'),null);
 assert.deepEqual(await gate.record(stationary,stationaryOffer.token,'start'),{state:'started'});
});

test('static URL, UID, QR, first-seen SDM and wrong challenge do not authorize time entry',async()=>{
 const {gate,writes}=fixture(),{challenge}=await gate.begin(terminal);
 for(const value of ['https://timeax.pl/tag/fixture','tag-UID','static-QR'])assert.equal(await gate.authorize(terminal,challenge,value),null);
 assert.equal(await gate.authorize(terminal,challenge,{...proof(uid(6)),authority:'first-seen-sdm'}),null);
 assert.equal(await gate.authorize(terminal,challenge,{...proof(uid(6)),challengeDigest:'c'.repeat(64)}),null);
 assert.equal(await gate.authorize(terminal,challenge,proof(uid(7))),null);
 assert.equal(writes.length,0);
});

test('same tap and same offer each usable at most once even with parallel calls, and end requires another tap',async()=>{
 const {gate,challenges,offers,writes}=fixture(),{challenge}=await gate.begin(terminal);
 assert.ok(!challenges.has(challenge));
 const candidates=await Promise.all([gate.authorize(terminal,challenge,proof(uid(6))),gate.authorize(terminal,challenge,proof(uid(6)))]);
 assert.equal(candidates.filter(Boolean).length,1);
 const offer=candidates.find(Boolean);
 assert.deepEqual(Object.keys(offer).sort(),['action','expiresAt','token']);
 assert.ok(!offers.has(offer.token));
 assert.equal(await gate.record({...terminal,agencyId:uid(90)},offer.token,'start'),null);
 assert.equal(await gate.record({...terminal,worksiteId:uid(90)},offer.token,'start'),null);
 assert.equal(await gate.record({...terminal,sessionBinding:'b'.repeat(43)},offer.token,'start'),null);
 assert.equal(await gate.record(terminal,offer.token,'end'),null);
 const starts=await Promise.all([gate.record(terminal,offer.token,'start'),gate.record(terminal,offer.token,'start')]);
 assert.deepEqual(starts.filter(Boolean),[{state:'started'}]);
 assert.equal(await gate.authorize(terminal,challenge,proof(uid(6))),null);
 const next=await tap(gate,terminal,uid(6));
 assert.equal(next.action,'end');
 assert.deepEqual(await gate.record(terminal,next.token,'end'),{state:'ended'});
 assert.deepEqual(writes.map(w=>w.action),['start','end']);
});

test('expired challenge is rejected before verifier; offers expire and revocations fail closed',async()=>{
 let f=fixture();const {challenge}=await f.gate.begin(terminal);f.advance(20000);
 assert.equal(await f.gate.authorize(terminal,challenge,proof(uid(6))),null);
 assert.equal(f.verified(),0);
 f=fixture();const offer=await tap(f.gate,terminal,uid(6));f.advance(10000);
 assert.equal(await f.gate.record(terminal,offer.token,'start'),null);
 for(const op of ['disableMode','revokeReader','endAssignment']){
  f=fixture();const offer=await tap(f.gate,terminal,uid(6));f[op]();
  assert.equal(await f.gate.record(terminal,offer.token,'start'),null);
  assert.equal(f.writes.length,0);
 }
});

test('a newer transition prevents use of a second old offer and a reused receipt cannot mint another',async()=>{
 const {gate}=fixture();
 const stableReceipt='e'.repeat(64);
 const a=await gate.begin(terminal),b=await gate.begin(terminal);
 const one=await gate.authorize(terminal,a.challenge,{...proof(uid(6)),tapReceipt:stableReceipt});
 assert.equal(await gate.authorize(terminal,b.challenge,{...proof(uid(6)),tapReceipt:stableReceipt}),null);
 const two=await gate.authorize(terminal,b.challenge,proof(uid(6)));
 assert.equal(two.action,'start');
 assert.deepEqual(await gate.record(terminal,one.token,'start'),{state:'started'});
 assert.equal(await gate.record(terminal,two.token,'start'),null);
});
