// Closed hosted single-process adapter. Real provider transport; no fixture and no account creation.
// Provider verification reuses the unchanged Dev09 verifier and bounded parsing from the pinned wire.
import {createIdentityVerifier} from '../wire/frozen-dev09-identity.server.mjs';
import {createHmac} from 'node:crypto';
const email=/^[^@\s\p{Cc}]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu;
const token=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const cap=64*1024;
const accepted=()=>Object.freeze({status:'accepted'});
const denied=()=>Object.freeze({state:'denied'});
const exact=(o,n)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===n.length&&n.every(k=>Object.hasOwn(o,k));
const responseMatches=(r,url)=>r instanceof Response&&!r.redirected&&(r.url===url);
async function limitedRaw(r){
  if(!r.body||r.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') throw Error();
  const announced=r.headers.get('content-length');
  if(announced!==null&&(!/^\d+$/.test(announced)||Number(announced)>cap))throw Error();
  const reader=r.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>cap)throw Error();chunks.push(value);}
    const raw=Buffer.concat(chunks,size);
    const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    if(!json||typeof json!=='object'||Array.isArray(json))throw Error();
    return {json,raw};
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function limit(fn,timeoutMs){
  const controller=new AbortController(); let timer;
  return Promise.race([Promise.resolve().then(()=>fn(controller.signal)),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},timeoutMs);})])
    .finally(()=>{clearTimeout(timer);controller.abort()});
}

export function createHostedExistingLogin(settings=null,{transport,checkReadiness,now=Date.now}={}){
 if(settings===null)return null;
 const {origin,recipient,routeKey,publishableKey,sessionLifetimeMs=60000,otpLength=6}=settings;
 const u=new URL(origin);
 if(settings.mode!=='reviewed-single-recipient-login'||u.origin!==origin||u.protocol!=='https:'||['timeax.pl','www.timeax.pl'].includes(u.hostname)
  ||!email.test(recipient??'')||recipient!==recipient.toLowerCase()||!/^sb_publishable_[A-Za-z0-9_-]{20,160}$/.test(publishableKey??'')
  ||!/^[-A-Za-z0-9_]{43}$/.test(routeKey??'')||typeof checkReadiness!=='function'||typeof transport!=='function'
  ||![6,8].includes(otpLength)||!Number.isInteger(sessionLifetimeMs)||sessionLifetimeMs<1000||sessionLifetimeMs>300000)throw Error('Closed existing login configuration denied');
 const projectRef='rohgpgogsdtiltbocdao',issuer='https://'+projectRef+'.supabase.co/auth/v1',timeoutMs=2500;
 const otpPattern=new RegExp("^[0-9]{"+otpLength+"}$");
 const proofs=new Map();let lastSendAt=-Infinity;
 const purge=()=>{for(const [id,p] of proofs)if(p.expiry<=now())proofs.delete(id)};
 const bindings=new WeakMap(),key=Buffer.from(routeKey,'base64url');
 const routeTag=ctx=>createHmac('sha256',key).update(JSON.stringify(['timeax/existing-hosted-single/v1',issuer,recipient,ctx.proofId,ctx.routeSecret])).digest('hex');
 const valid=ctx=>/^[-A-Za-z0-9_]{43}$/.test(ctx?.proofId??'')&&/^[-A-Za-z0-9_]{43}$/.test(ctx?.routeSecret??'');
  const headers={accept:'application/json','content-type':'application/json',apikey:publishableKey};
  async function post(suffix,data,inspect){
    const endpoint=issuer+suffix;
    return await limit(async signal=>{
      await checkReadiness({issuer,signal});
      const r=await transport(endpoint,{method:'POST',headers:{...headers},body:JSON.stringify(data),
        signal,redirect:'error',cache:'no-store',credentials:'omit'});
      if(!responseMatches(r,endpoint))return null;
      if(r.status!==200){void r.body?.cancel().catch(()=>{});return null;}
      return await inspect(r);
    },timeoutMs);
  }
  async function verifyOtpAndGetUser(input){
    if(input.issuer!==issuer||input.recipient!==recipient||typeof input.code!=='string'||!otpPattern.test(input.code))return null;
    const bearer=await post('/verify',{email:recipient,token:input.code,type:'email'},async r=>{
      const {json}=await limitedRaw(r);
      return typeof json.access_token==='string'&&json.access_token.length<=8100&&token.test(json.access_token)?json.access_token:null;
    });
    if(!bearer)return null;
    let user;
    // Reuse Dev09's exact verifier; the same bounded /user response drives
    // both canonical identity validation and the extra sealed-email check.
    const verifier=createIdentityVerifier({projectRef,publishableKey,timeoutMs},{now,transport:async (url,init)=>{
      if(url!==issuer+'/user'||init.method!=='GET'||init.headers.authorization!=='Bearer '+bearer)throw Error();
      await checkReadiness({issuer,signal:init.signal});
      const raw=await transport(url,init);
      if(!responseMatches(raw,url))throw Error();
      if(raw.status!==200)return raw;
      const body=await limitedRaw(raw);user=body.json;
      return new Response(body.raw,{status:200,headers:{'content-type':'application/json'}});
    }});
    const checked=await verifier.verify({headers:new Headers({authorization:'Bearer '+bearer})});
    if(!checked.ok||checked.identity.issuer!==issuer||!user||checked.identity.subject!==user.id||
       typeof user.email!=='string'||user.email.toLowerCase()!==recipient)return null;
    return Object.freeze({issuer,subject:checked.identity.subject,email:recipient,emailConfirmed:true,isAnonymous:false});
  }

 return Object.freeze({
  readIdentity:receipt=>bindings.get(receipt),
  async start(ctx){
   if(!valid(ctx)||!Number.isSafeInteger(ctx.expiresAt)||ctx.expiresAt<=now())return accepted();
   try{
    purge();const tag=routeTag(ctx),at=now();
    if(ctx.expiresAt>at+300000||proofs.size>=1000||proofs.has(ctx.proofId)||at-lastSendAt<60000)return accepted();
    const proof={tag,expiry:ctx.expiresAt,acknowledged:false,attempt:0,busy:false,consumed:false};
    proofs.set(ctx.proofId,proof);lastSendAt=at;
    if(await post('/otp',{email:recipient,create_user:false},async r=>{void r.body?.cancel().catch(()=>{});return true})===true
      &&proofs.get(ctx.proofId)===proof&&proof.expiry>now())proof.acknowledged=true;
   }catch{/* Neutral result; never create a user or claim delivery. */}
   return accepted();
  },
  async finish(ctx){
   if(!valid(ctx)||typeof ctx.code!=='string'||!otpPattern.test(ctx.code))return denied();
   try{
    purge();const proof=proofs.get(ctx.proofId);
    if(!proof||proof.tag!==routeTag(ctx)||!proof.acknowledged||proof.busy||proof.consumed||proof.attempt>=5)return denied();
    proof.busy=true;proof.attempt++;
    try{
     const identity=await verifyOtpAndGetUser({issuer,recipient,code:ctx.code});
     await checkReadiness({issuer,signal:AbortSignal.timeout(timeoutMs)});
     if(!identity||proof.expiry<=now()||proofs.get(ctx.proofId)!==proof||proof.consumed)return denied();
     proof.consumed=true;
     const receipt=Object.freeze({state:'pending',authenticated:true,grants:Object.freeze([])});
     bindings.set(receipt,Object.freeze({issuer,subject:identity.subject,email:identity.email,authenticatedAt:now(),emailConfirmed:true,isAnonymous:false,expiresAt:Math.min(proof.expiry,now()+sessionLifetimeMs)}));
     return receipt;
    }finally{proof.busy=false}
   }catch{return denied()}
  },
 });
}
