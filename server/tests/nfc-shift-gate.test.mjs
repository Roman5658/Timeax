import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNfcShiftGate,permitsTimeRecording,TIME_RECORDING_MODES} from '../lib/nfc-shift-gate.mjs';

test('effective settings keep manual, leader, and the two NFC recording channels separate',()=>{
 for(const mode of TIME_RECORDING_MODES)for(const channel of TIME_RECORDING_MODES)assert.equal(permitsTimeRecording(mode,channel),mode===channel);
 assert.equal(permitsTimeRecording(null,'manual'),false);
 assert.throws(()=>createNfcShiftGate({}));
});
test('NFC scope and one-use action are delegated to the atomic recorder under a trusted verifier boundary',async()=>{
 const uid=n=>'11234567-1234-4000-8000-'+String(n).padStart(12,'0');
 const scope={mode:'nfc_terminal',agencyId:uid(1),worksiteId:uid(2),membershipId:uid(3),readerId:uid(4),sessionBinding:'a'.repeat(43)};
 let verified=0,issued=0;const records=new Map();
 const gate=createNfcShiftGate({verifyTap:async(sc,proof)=>{verified++;assert.deepEqual(sc,scope);return proof==='fixture-tap'?'e'.repeat(64):null},
  store:{async authorize(data){issued++;assert.equal(data.ttlMs,10000);assert.equal(Object.hasOwn(data,'proof'),false);
   records.set(data.tokenDigest,data);return {action:'start',expiresAt:'2026-11-27T13:00:10Z'}},
  async record(data){const saved=records.get(data.tokenDigest);
   if(!saved||data.action!=='start'||Object.keys(scope).some(k=>saved[k]!==data[k]))return null;
   records.delete(data.tokenDigest);return {state:'started'};
  }}});
 assert.equal(await gate.authorize({...scope,mode:'manual'},'fixture-tap'),null);
 assert.equal(verified,0);assert.equal(await gate.authorize(scope,'ordinary-link'),null);assert.equal(issued,0);
 const permit=await gate.authorize(scope,'fixture-tap');
 assert.equal(permit.action,'start');assert.ok(!records.has(permit.token));
 assert.equal(await gate.record({...scope,agencyId:uid(5)},permit.token,'start'),null);
 assert.equal(await gate.record(scope,permit.token,'end'),null);
 assert.deepEqual(await gate.record(scope,permit.token,'start'),{state:'started'});
 assert.equal(await gate.record(scope,permit.token,'start'),null);
});
