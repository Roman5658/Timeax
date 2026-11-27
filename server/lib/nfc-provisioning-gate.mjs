import {createHash,randomBytes} from 'node:crypto';

const kinds=new Set(['terminal_reader','personal_card','stationary_tag']);
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)&&value!=='00000000-0000-0000-0000-000000000000';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const setupToken=value=>typeof value==='string'&&/^nsetup1_[A-Za-z0-9_-]{43}$/.test(value);
const hash=v=>createHash('sha256').update(v).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fresh=(value,now,max)=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Date.parse(value)>now&&Date.parse(value)<=now+max;
function adminScope(v){
 if(!exact(v,['adminMembershipId','agencyId','worksiteId'])||![v.adminMembershipId,v.agencyId,v.worksiteId].every(id))return null;
 return Object.freeze({adminMembershipId:v.adminMembershipId,agencyId:v.agencyId,worksiteId:v.worksiteId});
}
function purposeFor(v){
 const personal=v?.kind==='personal_card';
 if(!kinds.has(v?.kind)||!exact(v,['kind',...(personal?['membershipId']:[])])||personal&&!id(v.membershipId))return null;
 return Object.freeze({kind:v.kind,...(personal?{membershipId:v.membershipId}:{})});
}

// Offline-only contract. The authenticated admin scope comes from the
// caller's verified session and scoped membership lookup, not the request
// body. Store checks live agency/site authority and worker ownership again.
// Native verification must prove a grant-bound device/card provisioning
// exchange. Until it and the durable store are available, mount no routes.
export function createNfcProvisioningGate({origin,verifyProvisioning,store,now=Date.now,ttlMs=600_000}){
 let base;try{base=new URL(origin)}catch{}
 if(base?.origin!==origin||base?.protocol!=='https:'||typeof verifyProvisioning!=='function'||typeof now!=='function'||
    !['issueSetup','readSetup','consumeSetup','revokeSetup','revokeBinding'].every(k=>typeof store?.[k]==='function')||
    !Number.isInteger(ttlMs)||ttlMs<60_000||ttlMs>600_000)throw Error('NFC provisioning is not configured');

 async function issue(admin,purpose){
  const scope=adminScope(admin),intended=purposeFor(purpose);
  if(!scope||!intended)return null;
  const token='nsetup1_'+randomBytes(32).toString('base64url');
  const row=await store.issueSetup({scope,purpose:intended,tokenDigest:hash(token),ttlMs});
  if(!id(row?.grantId)||!fresh(row.expiresAt,now(),ttlMs))return null;
  // The raw grant is returned to the issuing admin once. The future setup
  // screen must scrub the fragment before any analytics, redirect or fetch.
  return {grantId:row.grantId,kind:intended.kind,expiresAt:row.expiresAt,setupLink:origin+'/nfc/setup#grant='+token};
 }

 async function claim(token,proof){
  if(!setupToken(token))return null;
  const tokenDigest=hash(token),row=await store.readSetup({tokenDigest});
  if(!id(row?.grantId)||!fresh(row.expiresAt,now(),ttlMs))return null;
  const scope=adminScope(row.scope),purpose=purposeFor(row.purpose);
  if(!scope||!purpose)return null;
  const validated=await verifyProvisioning({grantId:row.grantId,scope,purpose,proof});
  if(!exact(validated,['authority','grantId','kind','hardwareRef','receiptDigest'])||
    validated.authority!=='native-provisioning'||validated.grantId!==row.grantId||validated.kind!==purpose.kind||
    !id(validated.hardwareRef)||!hex(validated.receiptDigest)||!fresh(row.expiresAt,now(),ttlMs))return null;
  // Recheck authority / expiry / role / hardware and consume in one
  // transaction. Distinct credentials are issued by trusted composition.
  const result=await store.consumeSetup({grantId:row.grantId,tokenDigest,scope,purpose,hardwareRef:validated.hardwareRef,receiptDigest:validated.receiptDigest});
  return result?.state==='provisioned'&&id(result.bindingId)?{state:'provisioned',bindingId:result.bindingId,kind:purpose.kind}:null;
 }

 async function revokeGrant(admin,grantId){
  const scope=adminScope(admin);if(!scope||!id(grantId))return false;
  return await store.revokeSetup({scope,grantId})===true;
 }
 async function revokeDevice(admin,bindingId){
  const scope=adminScope(admin);if(!scope||!id(bindingId))return false;
  return await store.revokeBinding({scope,bindingId})===true;
 }
 return Object.freeze({issue,claim,revokeGrant,revokeDevice});
}
