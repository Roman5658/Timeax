import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNfcProvisioningGate} from '../lib/nfc-provisioning-gate.mjs';
import {createNfcShiftGate} from '../lib/nfc-shift-gate.mjs';

const id=n=>'71234567-1234-4000-8000-'+String(n).padStart(12,'0');
const origin='https://timeax.pl', admin={adminMembershipId:id(1),agencyId:id(2),worksiteId:id(3)}, second={adminMembershipId:id(4),agencyId:id(5),worksiteId:admin.worksiteId};
const matches=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]);
const proof={kind:'terminal_reader',hardwareRef:id(41),receiptDigest:'a'.repeat(64),fixture:true};
function build(){
 let now=Date.parse('2026-11-27T14:00:00Z'),n=10,verified=0,allowed=true;
 const grants=new Map(),bindings=new Map(),receipts=new Set(),usedHardware=new Set();
 const authorized=s=>allowed&&(matches(admin,s)||matches(second,s));
 const expires=ttl=>new Date(now+ttl).toISOString();
 const gate=createNfcProvisioningGate({origin,now:()=>now,
  verifyProvisioning:async({grantId,scope,purpose,proof})=>{
   verified++;
   assert.equal(Object.isFrozen(scope),true);assert.equal(Object.isFrozen(purpose),true);
   if(!proof?.fixture)return null;
   return {authority:proof.authority??'native-provisioning',grantId:proof.grantId??grantId,kind:proof.kind,hardwareRef:proof.hardwareRef,receiptDigest:proof.receiptDigest};
  },
  store:{
   async issueSetup({scope,purpose,tokenDigest,ttlMs}){
    if(!authorized(scope)||purpose.kind==='personal_card'&&(!matches(admin,scope)||purpose.membershipId!==id(6)))return null;
    const row={grantId:id(n++),scope,purpose,expiresAt:expires(ttlMs)};
    grants.set(tokenDigest,row);return row;
   },
   async readSetup({tokenDigest}){return grants.get(tokenDigest)},
   async consumeSetup({grantId,tokenDigest,scope,purpose,hardwareRef,receiptDigest}){
    const row=grants.get(tokenDigest);
    if(!authorized(scope)||!row||row.grantId!==grantId||Date.parse(row.expiresAt)<=now||
      !matches(row.scope,scope)||!matches(row.purpose,purpose)||receipts.has(receiptDigest)||usedHardware.has(hardwareRef))return null;
    grants.delete(tokenDigest);receipts.add(receiptDigest);usedHardware.add(hardwareRef);
    const bindingId=id(n++);
    bindings.set(bindingId,{scope,purpose,hardwareRef,revoked:false});
    return {state:'provisioned',bindingId,internalCardKey:'must-not-leak-in-receipt'};
   },
   async revokeSetup({scope,grantId}){
    if(!authorized(scope))return false;
    for(const [key,row] of grants)if(row.grantId===grantId&&matches(scope,row.scope)){grants.delete(key);return true}
    return false;
   },
   async revokeBinding({scope,bindingId}){
    const row=bindings.get(bindingId);if(!authorized(scope)||!row||!matches(scope,row.scope))return false;
    row.revoked=true;return true;
   },
  },
 });
 return {gate,grants,bindings,advance:n=>now+=n,verified:()=>verified,revokeAdmin:()=>allowed=false};
}
const tokenOf=record=>new URLSearchParams(new URL(record.setupLink).hash.slice(1)).get('grant');

test('setup scope distinguishes terminal, stationary point and an assigned personal card',async()=>{
 const {gate}=build();
 assert.equal(await gate.issue(admin,{kind:'personal_card'}),null);
 assert.equal(await gate.issue(admin,{kind:'stationary_tag',membershipId:id(6)}),null);
 assert.equal(await gate.issue(second,{kind:'personal_card',membershipId:id(6)}),null);
 const personal=await gate.issue(admin,{kind:'personal_card',membershipId:id(6)});
 assert.equal(personal.kind,'personal_card');
 const p=await gate.claim(tokenOf(personal),{...proof,kind:'personal_card'});
 assert.deepEqual(Object.keys(p).sort(),['bindingId','kind','state']);
 assert.equal(p.kind,'personal_card');
 const stationary=await gate.issue(second,{kind:'stationary_tag'});
 assert.equal(stationary.kind,'stationary_tag');
 assert.equal(await gate.claim(tokenOf(stationary),proof),null);
});

test('setup grant is separate from attendance, digest-only, and consumed once',async()=>{
 const {gate,grants}=build();
 const issued=await gate.issue(admin,{kind:'terminal_reader'}),token=tokenOf(issued);
 assert.equal(new URL(issued.setupLink).search,'');
 assert.match(token,/^nsetup1_[A-Za-z0-9_-]{43}$/);
 assert.equal(grants.has(token),false);
 assert.equal(grants.size,1);
 const quote=await Promise.all([gate.claim(token,proof),gate.claim(token,proof)]);
 assert.equal(quote.filter(Boolean).length,1);
 assert.equal(grants.size,0);
 assert.equal(await gate.claim(token,proof),null);
 const sameHardware=await gate.issue(admin,{kind:'terminal_reader'});
 assert.equal(await gate.claim(tokenOf(sameHardware),proof),null);

 let recorded=false;
 const eligibility=createNfcShiftGate({verifyTap:async()=>null,store:{
  async beginChallenge(){},async readChallenge(){},async authorize(){},
  async record(){recorded=true;return {state:'started'}},
 }});
 assert.equal(await eligibility.record({mode:'nfc_terminal',readerId:id(99),agencyId:admin.agencyId,worksiteId:admin.worksiteId,sessionBinding:'a'.repeat(43)},token,'start'),null);
 assert.equal(recorded,false);
});

test('setup grants expire, reject non-native evidence, and allow scoped pending/device revocation',async()=>{
 let f=build();
 const old=await f.gate.issue(admin,{kind:'terminal_reader'});f.advance(600000);
 assert.equal(await f.gate.claim(tokenOf(old),proof),null);
 assert.equal(f.verified(),0);
 f=build();
 const link=await f.gate.issue(admin,{kind:'terminal_reader'}), token=tokenOf(link);
 assert.equal(await f.gate.claim(token,'copied-link'),null);
 assert.equal(await f.gate.claim(token,{...proof,grantId:id(99)}),null);
 assert.equal(await f.gate.claim(token,{...proof,authority:'browser-asserted'}),null);
 assert.equal(await f.gate.revokeGrant(second,link.grantId),false);
 assert.equal(await f.gate.revokeGrant(admin,link.grantId),true);
 assert.equal(await f.gate.claim(token,proof),null);
 const fresh=await f.gate.issue(admin,{kind:'terminal_reader'});
 const device=await f.gate.claim(tokenOf(fresh),proof);
 assert.equal(await f.gate.revokeDevice(second,device.bindingId),false);
 assert.equal(await f.gate.revokeDevice(admin,device.bindingId),true);
 assert.equal(f.bindings.get(device.bindingId).revoked,true);
 const denied=await f.gate.issue(admin,{kind:'terminal_reader'});f.revokeAdmin();
 assert.equal(await f.gate.claim(tokenOf(denied),{...proof,hardwareRef:id(42),receiptDigest:'b'.repeat(64)}),null);
});
