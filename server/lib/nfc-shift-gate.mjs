import {createHash,randomBytes} from 'node:crypto';

const id=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)&&value!=='00000000-0000-0000-0000-000000000000';
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const TIME_RECORDING_MODES=Object.freeze(['nfc_terminal','nfc_stationary','leader','manual']);

// Evaluates an EFFECTIVE policy only. A saved preference never grants authority.
export function permitsTimeRecording(effectiveMode,channel){
 return TIME_RECORDING_MODES.includes(effectiveMode)&&effectiveMode===channel;
}
const validAction=action=>action==='start'||action==='end';
const fresh=(value,now,max)=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&
 Date.parse(value)>now&&Date.parse(value)<=now+max;

// Trusted scope is resolved from the sign-in/terminal credential, never a
// request body. A terminal is scoped before the scan, but has no member yet.
function trustedScope(scope){
 const stationary=scope?.mode==='nfc_stationary';
 if(!stationary&&scope?.mode!=='nfc_terminal')return null;
 if(!exact(scope,['mode','agencyId','worksiteId','readerId','sessionBinding',...(stationary?['membershipId']:[])])||
    ![scope.agencyId,scope.worksiteId,scope.readerId].every(id)||!opaque(scope.sessionBinding)||
    stationary&&!id(scope.membershipId))return null;
 const {mode,agencyId,worksiteId,readerId,sessionBinding}=scope;
 return Object.freeze({mode,agencyId,worksiteId,readerId,sessionBinding,...(stationary?{membershipId:scope.membershipId}:{})});
}

// Intentionally detached. Mount only with an authenticated hardware verifier
// and an atomic durable store. verifyTap must authenticate a live exchange
// bound to the server challenge, not a first-seen SUN URL, QR, or tag UID.
// The store independently checks scope, effective mode, device/card status
// and assignment. In one transaction, authorize consumes the challenge and
// unique tap receipt; record consumes the offer and records the transition
// (using server time, checking the expected open shift state/revision again).
// A terminal response never includes a worker identifier or profile.
export function createNfcShiftGate({verifyTap,store,now=Date.now,challengeMs=20_000,offerMs=10_000}){
 if(typeof verifyTap!=='function'||typeof now!=='function'||
    !['beginChallenge','readChallenge','authorize','record'].every(x=>typeof store?.[x]==='function')||
    !Number.isInteger(challengeMs)||challengeMs<5000||challengeMs>30000||
    !Number.isInteger(offerMs)||offerMs<1000||offerMs>15000)throw Error('NFC recording is not configured');

 async function begin(scope){
  const bound=trustedScope(scope);
  if(!bound)return null;
  const challenge=randomBytes(32).toString('base64url');
  const opened=await store.beginChallenge({...bound,challengeDigest:digest(challenge),ttlMs:challengeMs});
  return fresh(opened?.expiresAt,now(),challengeMs)?{challenge,expiresAt:opened.expiresAt}:null;
 }

 async function authorize(scope,challenge,proof){
  const bound=trustedScope(scope);
  if(!bound||!opaque(challenge))return null;
  const challengeDigest=digest(challenge);
  const open=await store.readChallenge({...bound,challengeDigest});
  if(!fresh(open?.expiresAt,now(),challengeMs))return null;
  // The verifier alone handles hardware bytes. Neither a URL-like field nor
  // a browser timestamp/counter can produce this typed authenticated result.
  const receipt=await verifyTap({scope:bound,challenge,challengeDigest,proof});
  if(!exact(receipt,['authority','tapReceipt','challengeDigest','cardId'])||
    receipt.authority!=='authenticated-challenge'||!hex(receipt.tapReceipt)||
    receipt.challengeDigest!==challengeDigest||!id(receipt.cardId))return null;
  if(!fresh(open.expiresAt,now(),challengeMs))return null;
  const token=randomBytes(32).toString('base64url');
  const offer=await store.authorize({...bound,challengeDigest,tokenDigest:digest(token),
   tapReceipt:receipt.tapReceipt,cardId:receipt.cardId,ttlMs:offerMs});
  return validAction(offer?.action)&&fresh(offer.expiresAt,now(),offerMs)?{token,action:offer.action,expiresAt:offer.expiresAt}:null;
 }

 async function record(scope,token,action){
  const bound=trustedScope(scope);
  if(!bound||!opaque(token)||!validAction(action))return null;
  const result=await store.record({...bound,tokenDigest:digest(token),action});
  const state=action==='start'?'started':'ended';
  return result?.state===state?{state}:null;
 }
 return Object.freeze({begin,authorize,record});
}
