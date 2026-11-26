import {randomBytes,createPublicKey} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {PROTOCOL,CONTROL_PATH,ISSUER,exact,validateBinding,verifyWindow,verifyLease,tokenDigest} from './readiness-protocol.mjs';
import {readBody} from './session-router.mjs';
const json=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'}});
export function createReadinessDelivery({rootPublicKeyPem,binding,databaseScope='reviewed-pending-only',now=Date.now,monotonic=()=>performance.now()}){
 validateBinding(binding);const key=createPublicKey(rootPublicKeyPem);if(key.asymmetricKeyType!=='ed25519')throw Error('Approval key required');
 const bootId=randomBytes(32).toString('base64url');
 let current=null,closed=false,lastSequence=0,lastDigest=null,lastWall=now(),monoExpiry=0;
 const clock=()=>{const at=now();if(at<lastWall){closed=true;current=null;throw Error('Clock moved backwards')}lastWall=at;return at};
 function readiness({issuer,signal}){
  const at=clock();
  if(signal?.aborted||issuer!==ISSUER||closed||!current||monotonic()>=monoExpiry)throw Error('Readiness absent');
  const {window:w,publisherKey}=verifyWindow(current.window,key,at,{binding,bootId,databaseScope});
  const lease=verifyLease(current.lease,publisherKey,w,at);if(lease.state!=='ready')throw Error('Readiness closed');
  return {issuer:ISSUER,hook:w.hook,signup:w.signup,scope:w.scope,checkedAt:lease.checkedAt,validUntil:lease.validUntil};
 }
 function status(){
  let state='closed';try{readiness({issuer:ISSUER});state='lease-present'}catch{}
  return {protocol:PROTOCOL,bootId,databaseScope,binding:{...binding},state,windowConsumed:current!==null||closed};
 }
 async function receive(request){
  try{
   const raw=await readBody(request,18000),body=JSON.parse(raw);
   if(!exact(body,['window','lease'])||typeof body.window!=='string'||typeof body.lease!=='string')throw Error();
   const at=clock(),{window:w,publisherKey}=verifyWindow(body.window,key,at,{binding,bootId,databaseScope});
   const lease=verifyLease(body.lease,publisherKey,w,at),digest=tokenDigest(body.lease);
   // One independently approved window per process. Closing is irreversible for that process.
   if(closed||current&&current.window!==body.window)throw Error();
   if(lease.sequence===lastSequence&&digest===lastDigest)return json(200,{accepted:true,renewed:false,registrationReady:false});
   if(lease.sequence<=lastSequence)throw Error();
   lastSequence=lease.sequence;lastDigest=digest;current=body;
   monoExpiry=monotonic()+Math.max(0,lease.validUntil-at);
   if(lease.state==='closed')closed=true;
   return json(200,{accepted:true,renewed:true,registrationReady:false});
  }catch{return json(503,{accepted:false,state:'closed'})}
 }
 return Object.freeze({readiness,status,wrap:handler=>async request=>{
  const u=new URL(request.url);if(u.pathname!==CONTROL_PATH)return handler(request);
  if(u.origin!==binding.origin||u.search||u.hash||request.headers.get('origin')&&request.headers.get('origin')!==binding.origin)return json(403,{state:'closed'});
  if(request.method==='GET')return json(200,status());
  if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json(405,{state:'closed'});
  return receive(request);
 }});
}
