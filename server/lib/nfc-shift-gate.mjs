import {createHash,randomBytes} from 'node:crypto';

const id=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
export const TIME_RECORDING_MODES=Object.freeze(['nfc_terminal','nfc_stationary','leader','manual']);

// Evaluates an EFFECTIVE policy only. A saved preference never grants authority.
export function permitsTimeRecording(effectiveMode,channel){
 return Object.hasOwn({nfc_terminal:1,nfc_stationary:1,leader:1,manual:1},effectiveMode)&&effectiveMode===channel;
}
const nfcMode=value=>value==='nfc_terminal'||value==='nfc_stationary';
const scopeValid=s=>s&&nfcMode(s.mode)&&[s.agencyId,s.worksiteId,s.membershipId,s.readerId].every(id)&&opaque(s.sessionBinding);
const actionValid=action=>action==='start'||action==='end';

// No production composition until a hardware verifier and an atomic DB store
// have passed on-device review. verifyTap must consume a genuine fresh proof,
// bind its card/terminal and actor to the resolved scope, and reject reused scans.
// Only trusted, session-derived scope may enter either method. Never forward body
// fields as scope. The store must recheck current policy, assignment and reader
// status; consume + record (server timestamp) must be one database transaction.
export function createNfcShiftGate({verifyTap,store,ttlMs=10_000}){
 if(typeof verifyTap!=='function'||!['authorize','record'].every(x=>typeof store?.[x]==='function')||
    !Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>15000)throw Error('NFC recording is not configured');
 async function authorize(scope,proof){
  if(!scopeValid(scope))return null;
  const tapReceipt=await verifyTap({...scope},proof);
  if(typeof tapReceipt!=='string'||!/^[a-f0-9]{64}$/.test(tapReceipt))return null;
  const token=randomBytes(32).toString('base64url');
  const offer=await store.authorize({...scope,tokenDigest:digest(token),tapReceipt,ttlMs});
  return offer&&actionValid(offer.action)&&typeof offer.expiresAt==='string'?{token,action:offer.action,expiresAt:offer.expiresAt}:null;
 }
 async function record(scope,token,action){
  if(!scopeValid(scope)||!opaque(token)||!actionValid(action))return null;
  return store.record({...scope,tokenDigest:digest(token),action});
 }
 return Object.freeze({authorize,record});
}
