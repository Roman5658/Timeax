// Public verification only. No private signing operation is shipped in the web runtime.
import {createPublicKey,verify,createHash} from 'node:crypto';
export const PROTOCOL='timeax/readiness-push-window/v1';
export const CONTROL_PATH='/api/timeax/control/readiness';
export const ISSUER='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
export const MAX_WINDOW_MS=600000,MAX_LEASE_MS=30000;
export const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export function verifyToken(token,key){
 if(typeof token!=='string'||token.length>12000)throw Error('Signed control denied');
 const parts=token.split('.');if(parts.length!==2)throw Error('Signed control denied');
 const raw=Buffer.from(parts[0],'base64url'),sig=Buffer.from(parts[1],'base64url');
 const publicKey=typeof key==='string'?createPublicKey(key):key;
 if(publicKey.asymmetricKeyType!=='ed25519'||raw.toString('base64url')!==parts[0]||sig.length!==64||sig.toString('base64url')!==parts[1]||!verify(null,raw,publicKey,sig))throw Error('Signed control denied');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}
export function validateBinding(b){
 if(!exact(b,['issuer','origin','recipientTag','buildSha256','contractSha256'])||b.issuer!==ISSUER||![b.recipientTag,b.buildSha256,b.contractSha256].every(hex))throw Error('Release binding denied');
 const u=new URL(b.origin);
 if(u.origin!==b.origin||u.protocol!=='https:'||u.username||u.password||['timeax.pl','www.timeax.pl'].includes(u.hostname))throw Error('Isolated origin required');
 return b;
}
export function verifyWindow(token,rootPublicKey,at,expected){
 const w=verifyToken(token,rootPublicKey);
 if(!exact(w,['purpose','binding','bootId','id','publisherKey','evidenceSha256','evidenceMode','checkedAt','validUntil','hook','signup','scope','mail','database','instances'])||
 w.purpose!==PROTOCOL||w.evidenceMode!=='operator-supervised-window'||!id(w.bootId)||!id(w.id)||!hex(w.evidenceSha256)||w.hook!=='verified-deny-by-default'||w.signup!=='separately-approved'||w.scope!=='pending-no-app-rights'||
 w.mail!=='operator-confirmed-ready'||!['reviewed-pending-only','reviewed-pending-and-workspace-read','reviewed-integrated-qa'].includes(w.database)||w.instances!==1||
 !Number.isSafeInteger(w.checkedAt)||!Number.isSafeInteger(w.validUntil)||w.checkedAt>at||w.validUntil<=at||w.validUntil-w.checkedAt>MAX_WINDOW_MS)throw Error('Window expired or unreviewed');
 validateBinding(w.binding);
 if(expected&&(expected.databaseScope&&w.database!==expected.databaseScope||w.bootId!==expected.bootId||Object.keys(w.binding).some(k=>w.binding[k]!==expected.binding[k])))throw Error('Window release or process differs');
 const der=Buffer.from(w.publisherKey??'','base64url');
 if(der.length!==44||der.toString('base64url')!==w.publisherKey)throw Error('Publisher key denied');
 const key=createPublicKey({key:der,format:'der',type:'spki'});
 if(key.asymmetricKeyType!=='ed25519')throw Error('Publisher key denied');
 return {window:w,publisherKey:key};
}
export function verifyLease(token,key,w,at){
 const v=verifyToken(token,key);
 if(!exact(v,['purpose','windowId','bootId','sequence','checkedAt','validUntil','state'])||v.purpose!=='timeax/readiness-lease/v1'||v.windowId!==w.id||v.bootId!==w.bootId||
 !Number.isSafeInteger(v.sequence)||v.sequence<1||!Number.isSafeInteger(v.checkedAt)||!Number.isSafeInteger(v.validUntil)||
 v.checkedAt< w.checkedAt||v.checkedAt>at||v.validUntil<=at||v.validUntil>w.validUntil||v.validUntil-v.checkedAt>MAX_LEASE_MS||!['ready','closed'].includes(v.state))throw Error('Lease expired or denied');
 return v;
}
export const tokenDigest=token=>createHash('sha256').update(token).digest('hex');
