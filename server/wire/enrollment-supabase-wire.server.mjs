import {createIdentityVerifier} from './frozen-dev09-identity.server.mjs';
import {createIdentityOnlyPending} from './identity-only-pending.server.mjs';

export const EXPECTED_PROJECT='rohgpgogsdtiltbocdao';
const expectedIssuer='https://'+EXPECTED_PROJECT+'.supabase.co/auth/v1';
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

export function createEnrollmentSupabaseWire(settings=null,{transport,checkHookReadiness,verifyProviderWebhook,db,enrollmentStore,now=Date.now,otpLength=6}={}){
  if(settings===null)return Object.freeze({start:async()=>accepted(),authorizeCreation:async()=>denied(),finish:async()=>denied()});
  if(!exact(settings,['mode','projectRef','issuer','recipient','intentKey','routeKey','publishableKey','timeoutMs'])||
    settings.mode!=='reviewed-enrollment-wire' || settings.projectRef!==EXPECTED_PROJECT || settings.issuer!==expectedIssuer ||
    typeof settings.recipient!=='string'||settings.recipient.length>254||!email.test(settings.recipient)||
    typeof settings.publishableKey!=='string'||
    !/^sb_publishable_[A-Za-z0-9_-]{20,160}$/.test(settings.publishableKey??'')||
    !Number.isInteger(settings.timeoutMs)||settings.timeoutMs<10||settings.timeoutMs>10_000||
    typeof transport!=='function'||typeof checkHookReadiness!=='function'||typeof verifyProviderWebhook!=='function'||
    typeof now!=='function'||![6,8].includes(otpLength)||(!enrollmentStore&&typeof db?.query!=='function'))throw Error('Enrollment wire configuration denied');
  const {projectRef,issuer,publishableKey,timeoutMs,intentKey,routeKey}=settings;
  const recipient=settings.recipient.toLowerCase();
  const otpPattern=new RegExp("^[0-9]{"+otpLength+"}$");
  async function permitted(){
    try{
      const gate=await limit(signal=>checkHookReadiness({issuer,signal}),timeoutMs), at=now();
      return exact(gate,['issuer','hook','signup','scope','checkedAt','validUntil'])&&gate.issuer===issuer&&
        gate.hook==='verified-deny-by-default'&&gate.signup==='separately-approved'&&gate.scope==='pending-no-app-rights'&&
        Number.isSafeInteger(gate.checkedAt)&&Number.isSafeInteger(gate.validUntil)&&
        gate.checkedAt<=at&&gate.validUntil>at&&gate.validUntil-gate.checkedAt<=60_000;
    }catch{return false;}
  }
  const headers={accept:'application/json','content-type':'application/json',apikey:publishableKey};
  async function post(suffix,data,inspect){
    const endpoint=issuer+suffix;
    return await limit(async signal=>{
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
  const proof=createIdentityOnlyPending({mode:'local-pinned-fixture',policy:{issuer,recipient,intentKey,routeKey},
    db,enrollmentStore,verifyProviderWebhook,verifyOtpAndGetUser,now,requireProviderAck:true,otpLength});
  return Object.freeze({
    async start(ctx){
      // No browser challenge is read here; callers are trusted route handlers.
      // Availability is an independent, fresh trusted control-plane observation,
      // not a flag the browser or transport response can grant. No local default.
      if(!await permitted())return accepted();
      const data=await proof.begin(ctx);
      if(!data)return accepted();
      try{
        // A further independent check after DB reservation, before requesting
        // provider account creation. Any ambiguity consumes one attempt closed.
        if(await permitted()&&await post('/otp',{email:recipient,create_user:true,data},async r=>{
          void r.body?.cancel().catch(()=>{});return true;
        })===true)
          await proof.acknowledge(ctx);
      }catch{ /* never expose errors, upstream details, or retry automatically */ }
      return accepted();
    },
    authorizeCreation(raw,signatureHeaders){
      // A synchronous provider callback must see the independently sealed
      // approval (not merely the POST response or public browser auth state).
      return permitted().then(ok=>ok?proof.authorizeCreation(raw,signatureHeaders):denied());
    },
    async finish(ctx){
      if(!await permitted())return denied();
      return await proof.finish(ctx);
    },
  });
}
