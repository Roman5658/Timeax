import {Webhook} from 'standardwebhooks';
import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export const ISSUER='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
export function createProviderTransport({fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=='function')throw Error('Missing HTTP transport');
 return async(url,init)=>{
  const path=typeof url==='string'&&url.startsWith(ISSUER+'/')?url.slice(ISSUER.length):'';
  const permitted=(path==='/otp'||path==='/verify'||path==='/token?grant_type=password')&&init?.method==='POST'
   ||path==='/user'&&['GET','PUT'].includes(init?.method);
  if(!permitted||init.redirect!=='error'||init.credentials!=='omit'||!init.signal)throw Error('Provider transport denied');
  const res=await fetchImpl(url,init);
  if(!(res instanceof Response)||res.redirected||res.url!==url)throw Error('Provider response denied');
  return res;
 };
}
export function createProviderWebhookVerifier(secret){
 if(typeof secret==='string'&&secret.startsWith('v1,whsec_'))secret=secret.slice(3);
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/=]+$/.test(secret)||Buffer.from(secret.slice(6),'base64').length<32)throw Error('Invalid webhook configuration');
 const sdk=new Webhook(secret);
 return async(raw,headers)=>{
  if(typeof raw!=='string'||Buffer.byteLength(raw)>20480)throw Error('Invalid webhook body');
  const selected={};
  for(const name of ['webhook-id','webhook-timestamp','webhook-signature']){
   const value=headers instanceof Headers?headers.get(name):headers?.[name];
   if(typeof value!=='string'||value.length>2048)throw Error('Invalid webhook headers');selected[name]=value;
  }
  if(!/^\d{10}$/.test(selected['webhook-timestamp']))throw Error('Invalid timestamp');
  // SDK verifies the raw bytes before returning parsed JSON; no fallback parser.
  return sdk.verify(raw,selected);
 };
}
export function createSignedApprovalReader({publicKeyPem,readinessPath,read=readFile,now=Date.now}){
 const key=createPublicKey(publicKeyPem);if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 approval key required');
 const decode=token=>{
  if(typeof token!=='string'||token.length>8192)throw Error('Invalid approval');
  const parts=token.split('.');if(parts.length!==2)throw Error('Invalid approval');
  const raw=Buffer.from(parts[0],'base64url'),sig=Buffer.from(parts[1],'base64url');
  if(raw.toString('base64url')!==parts[0]||sig.length!==64||sig.toString('base64url')!==parts[1]||!verifySignature(null,raw,key,sig))throw Error('Approval signature denied');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 };
 return Object.freeze({
  async readiness({issuer,signal}){
   if(signal?.aborted||issuer!==ISSUER)throw Error('Readiness unavailable');
   const token=await read(readinessPath,{encoding:'utf8',signal});const value=decode(token.trim()),at=now();
   const fields=['issuer','hook','signup','scope','checkedAt','validUntil'];
   if(!value||Object.keys(value).length!==fields.length||!fields.every(k=>Object.hasOwn(value,k))
    ||value.issuer!==ISSUER||value.hook!=='verified-deny-by-default'||value.signup!=='separately-approved'
    ||value.scope!=='pending-no-app-rights'||!Number.isSafeInteger(value.checkedAt)||!Number.isSafeInteger(value.validUntil)
    ||value.checkedAt>at||value.validUntil<=at||value.validUntil-value.checkedAt>60000)throw Error('Readiness expired or denied');
   return value;
  },
  permit(token,recipientTag){
   try{const p=decode(token);return p?.purpose==='timeax/enrollment-route/v1'&&p.issuer===ISSUER
    &&p.recipientTag===recipientTag&&typeof p.id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(p.id)
    &&Number.isSafeInteger(p.issuedAt)&&Number.isSafeInteger(p.expiresAt)&&p.issuedAt<=now()
    &&p.expiresAt>now()&&p.expiresAt-p.issuedAt<=300000?p:null}catch{return null}
  },
 });
}
