import {createHmac,randomBytes} from 'node:crypto';
import {ISSUER} from './provider-adapters.mjs';
import {normalizePublicEmail,validPasswordInput,validNewPassword} from './public-email-provider.mjs';
import {readBody} from './session-router.mjs';

const login='/api/timeax/auth/public/password',setup='/api/timeax/agency/setup';
const registrationTermsVersion='2026-11-27';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const validId=id=>typeof id==='string'&&uuid.test(id)&&id!=='00000000-0000-0000-0000-000000000000';
const weights=[6,5,7,2,3,4,5,6,7];
const goodNip=n=>/^\d{10}$/.test(n)&&! /^(\d)\1{9}$/.test(n)&&weights.reduce((sum,w,i)=>sum+w*Number(n[i]),0)%11===Number(n[9]);
const respond=(status,body,cookie)=>Response.json(body,{status,headers:{
 'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})}});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const identityOf=s=>s&&s.issuer===ISSUER&&validId(s.subject)&&s.emailConfirmed===true&&s.isAnonymous===false?
 {issuer:s.issuer,subject:s.subject}:null;

// Only compose this with a role-pinned store and after workspace routing is ready.
// OTP setup credentials stay server-side; normal login OTPs cannot set a password.
export function createAgencyOnboardingRoutes({origin,provider,store,readSession,issueSession,isActive,now=Date.now}){
 if(![provider?.passwordLogin,provider?.setPassword,store?.get,store?.create,readSession,issueSession,isActive].every(f=>typeof f==='function'))
  throw Error('Incomplete agency onboarding configuration');
 const key=randomBytes(32),attempts=new Map(),windowMs=60_000;
 let total=0,windowStart=now();
 function admit(email){
  const at=now();if(at-windowStart>=windowMs){attempts.clear();total=0;windowStart=at}
  const tag=createHmac('sha256',key).update(email).digest('hex'),n=attempts.get(tag)??0;
  if(total>=60||n>=6)return false;
  total++;attempts.set(tag,n+1);return true;
 }
 const matches=path=>path===login||path===setup;
 return {matches,async handler(request){
  try{
   const url=new URL(request.url),path=url.pathname,post=request.method==='POST',from=request.headers.get('origin');
   const site=request.headers.get('sec-fetch-site');
   if(url.origin!==origin||url.search||url.hash||!matches(path)||request.signal.aborted||
    (post?from!==origin:from!==null&&from!==origin)||site!==null&&site!=='same-origin')
    return respond(403,{error:'not-permitted'});
   if(path===login){
    if(!post)return respond(405,{error:'not-allowed'});
    let body;try{body=JSON.parse(await readBody(request,2048))}catch{}
    if(!exact(body,['email','password'])||!validPasswordInput(body.password))
     return respond(400,{error:'invalid-request'});
    const email=normalizePublicEmail(body.email);
    if(!email)return respond(400,{error:'invalid-request'});
    if(!admit(email))return respond(429,{error:'try-later'});
    const identity=await provider.passwordLogin(email,body.password);
    if(!identityOf(identity)||request.signal.aborted)return respond(401,{error:'invalid-credentials'});
    const organizationId=await store.get(identityOf(identity));
    if(organizationId!==null&&!validId(organizationId))throw Error('Invalid workspace response');
    if(request.signal.aborted)return respond(400,{error:'invalid-request'});
    return respond(200,{state:organizationId?'ready':'details-required',organizationId},issueSession(identity,request));
   }
   if(!['GET','POST'].includes(request.method))return respond(405,{error:'not-allowed'});
   const session=readSession(request),identity=identityOf(session);
   if(!identity||!isActive(request,session))return respond(401,{error:'valid-session-required'});
   const old=await store.get(identity);
   if(!isActive(request,session))return respond(401,{error:'valid-session-required'});
   if(old!==null){
    if(!validId(old))throw Error('Invalid workspace response');
    return respond(200,{state:'ready',organizationId:old});
   }
   const passwordRequired=session.flow!=='password'&&session.passwordSet!==true;
   if(passwordRequired&&(session.flow!=='registration'||!session.credential))return respond(403,{error:'registration-required'});
   if(!post)return respond(200,{state:'details-required',passwordRequired});
   if(session.finishing)return respond(409,{error:'setup-in-progress'});
   session.finishing=true;
   try{
    let body;try{body=JSON.parse(await readBody(request,2048))}catch{}
    if(body?.termsVersion!==registrationTermsVersion)return respond(400,{error:'terms-required'});
    if(!exact(body,passwordRequired?['agencyName','nip','password','termsVersion']:['agencyName','nip','termsVersion'])||typeof body.agencyName!=='string'||typeof body.nip!=='string')
     return respond(400,{error:'invalid-request'});
    const agencyName=body.agencyName.trim(),nip=body.nip.trim().replace(/[ -]/g,'');
    if([...agencyName].length<2||[...agencyName].length>120||/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(agencyName))
     return respond(400,{error:'invalid-name'});
    if(!goodNip(nip))return respond(400,{error:'invalid-nip'});
    if(!isActive(request,session))return respond(401,{error:'valid-session-required'});
    if(passwordRequired){
     if(!validNewPassword(body.password))return respond(400,{error:'invalid-password'});
     if(await provider.setPassword(session.credential,body.password)!==true)return respond(409,{error:'password-not-set'});
     session.passwordSet=true;session.credential=null;
    }
    if(!isActive(request,session))return respond(401,{error:'valid-session-required'});
    const organizationId=await store.create(identity,{agencyName,nip});
    if(!validId(organizationId))throw Error('Invalid workspace response');
    if(!isActive(request,session))return respond(401,{error:'valid-session-required'});
    return respond(200,{state:'ready',organizationId});
   }finally{session.finishing=false}
  }catch{return respond(503,{error:'service-unavailable'})}
 }};
}
