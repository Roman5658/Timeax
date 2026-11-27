import {createHmac,randomBytes} from 'node:crypto';
import {ISSUER} from './provider-adapters.mjs';
import {normalizePublicEmail} from './public-email-provider.mjs';
import {readBody} from './session-router.mjs';

const START='/api/timeax/auth/public/start',VERIFY='/api/timeax/auth/public/verify';
const CHALLENGE='__Host-timeax-email-challenge',SESSION='__Host-timeax-email-identity';
const token=/^[A-Za-z0-9_-]{43}$/;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const TTL=300_000,COOLDOWN=60_000,MAX_RECORDS=1_000,MAX_ATTEMPTS=5,GLOBAL_MINUTE_LIMIT=30;
const cookie=(name,value='',seconds=0)=>name+'='+value+'; Max-Age='+seconds+'; Path=/; Secure; HttpOnly; SameSite=Strict';
function getChallenge(request,challengeName){
 const header=request.headers.get('cookie');
 if(!header||header.length>8192)return null;
 const matches=header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(challengeName+'='));
 const id=matches.length===1?matches[0].slice(challengeName.length+1):'';
 return token.test(id)?id:null;
}
function respond(status,body,cookies=[]){
 const headers=new Headers({'Cache-Control':'no-store, private','Content-Type':'application/json','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 for(const value of cookies)headers.append('Set-Cookie',value);
 return new Response(JSON.stringify(body),{status,headers});
}
const denied=()=>respond(401,{error:'verification-failed'});

export const isPublicEmailRoute=path=>path===START||path===VERIFY;

// Single-process challenge lane. A deployment must supply an independent send
// admission/abuse check and its own identity-only session issuer before enabling.
export function createPublicEmailRoutes({origin,provider,admitSend,issueIdentitySession,tagKey,otpLength,localLoopback=false,now=Date.now,retainPasswordSetup=false,retainWorkerPassword=()=>false,maxSessionAge=900,allowNewWorkerIdentity=null,readSessionId=()=>null}){
 if(!(localLoopback?/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin):['https://timeax.pl','https://www.timeax.pl'].includes(origin))||![6,8].includes(otpLength)
  ||typeof provider?.requestCode!=='function'||typeof provider?.verifyCode!=='function'
  ||typeof admitSend!=='function'||typeof issueIdentitySession!=='function'
  ||!Buffer.isBuffer(tagKey)||tagKey.length<32)throw Error('Public email route configuration incomplete');
 const challengeName=localLoopback?'timeax-loopback-email-challenge':CHALLENGE,sessionName=localLoopback?'timeax-loopback-email-identity':SESSION;
 const issueCookie=(...args)=>localLoopback?cookie(...args).replace('; Secure',''):cookie(...args);
 const challenges=new Map(),lastSend=new Map(),sendTimes=[],pattern=new RegExp('^[0-9]{'+otpLength+'}$');
 const tag=email=>createHmac('sha256',tagKey).update(email).digest('hex');
 const clean=at=>{
  for(const [id,pending] of challenges)if(pending.expires<=at)challenges.delete(id);
  for(const [id,last] of lastSend)if(last+COOLDOWN<=at)lastSend.delete(id);
  while(sendTimes.length&&sendTimes[0]+COOLDOWN<=at)sendTimes.shift();
 };
 const handler=async request=>{
  try{
   const url=new URL(request.url);
   if(url.origin!==origin||url.username||url.password||url.search||url.hash||!isPublicEmailRoute(url.pathname))
    return respond(404,{error:'not-found'});
   if(request.method!=='POST')return respond(405,{error:'not-allowed'});
   const site=request.headers.get('sec-fetch-site');
   if(request.headers.get('origin')!==origin||site!==null&&site!=='same-origin')return respond(403,{error:'not-permitted'});
   if(request.signal.aborted)return respond(400,{error:'invalid-request'});
   let body;
   try{body=JSON.parse(await readBody(request,2048))}catch{return respond(400,{error:'invalid-request'})}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!== (url.pathname===START?2:1))
    return respond(400,{error:'invalid-request'});
   const at=now();clean(at);
   if(url.pathname===START){
    const email=normalizePublicEmail(body.email),flow=body.flow;
    if(!email||!['login','registration'].includes(flow))return respond(400,{error:'invalid-request'});
    const previous=getChallenge(request,challengeName),previousChallenge=challenges.get(previous);
    const key=tag(email);
    if(lastSend.has(key))return respond(202,{status:'accepted'});
    if(challenges.size>=MAX_RECORDS||sendTimes.length>=GLOBAL_MINUTE_LIMIT)return respond(429,{error:'try-later'});
    if(await admitSend({request,flow,emailTag:key,email})!==true)return respond(429,{error:'try-later'});
    // Recheck after awaiting admission so parallel sends cannot share one slot.
    const startedAt=now();clean(startedAt);
    if(request.signal.aborted)return respond(400,{error:'invalid-request'});
    if(lastSend.has(key))return respond(202,{status:'accepted'});
    if(challenges.size>=MAX_RECORDS||sendTimes.length>=GLOBAL_MINUTE_LIMIT)return respond(429,{error:'try-later'});
    if(previousChallenge&&!previousChallenge.busy)challenges.delete(previous);
    const id=randomBytes(32).toString('base64url');
    const challenge={email,flow,expires:startedAt+TTL,attempts:0,busy:false,acknowledged:false};
    challenges.set(id,challenge);lastSend.set(key,startedAt);sendTimes.push(startedAt);
    // Return the same external status for provider accept/deny; never claim delivery.
    try{
     let providerFlow=flow;
     if(flow==='login'&&allowNewWorkerIdentity){
      const isPrepared=await Promise.resolve().then(()=>allowNewWorkerIdentity(email)).catch(()=>false);
      if(isPrepared===true)providerFlow='registration';
     }
     if(!request.signal.aborted&&challenges.get(id)===challenge&&challenge.expires>now())
      challenge.acknowledged=await provider.requestCode(email,providerFlow)===true;
    }catch{}
    return respond(202,{status:'accepted'},[issueCookie(challengeName,id,TTL/1000)]);
   }
   if(typeof body.code!=='string'||!pattern.test(body.code))return respond(400,{error:'invalid-request'});
   const id=getChallenge(request,challengeName),challenge=challenges.get(id);
   if(!challenge||challenge.busy||!challenge.acknowledged||challenge.attempts>=MAX_ATTEMPTS)return denied();
   challenge.attempts++;challenge.busy=true;
   try{
    const setup=retainPasswordSetup&&challenge.flow==='registration';
    const workerSetup=challenge.flow==='login'&&retainWorkerPassword()===true;
    const identity=await provider.verifyCode(challenge.email,body.code,...(setup||workerSetup?[{forPasswordSetup:true}]:[]));
    if(!identity||identity.issuer!==ISSUER||typeof identity.subject!=='string'||!uuid.test(identity.subject)
     ||identity.subject==='00000000-0000-0000-0000-000000000000'||identity.emailConfirmed!==true||identity.isAnonymous!==false
     ||challenges.get(id)!==challenge||challenge.expires<=now()||request.signal.aborted)return denied();
    challenges.delete(id);
    const session=await issueIdentitySession({issuer:identity.issuer,subject:identity.subject,
     email:challenge.email,emailConfirmed:true,isAnonymous:false,flow:challenge.flow},setup||workerSetup?identity:null,readSessionId(request));
    if(!token.test(session?.id??'')||!Number.isInteger(session?.maxAge)||session.maxAge<1||session.maxAge>maxSessionAge)
     return respond(503,{error:'service-unavailable'});
    return respond(200,{status:'email-verified'},[issueCookie(sessionName,session.id,session.maxAge),issueCookie(challengeName)]);
   }finally{challenge.busy=false}
  }catch{return respond(503,{error:'service-unavailable'})}
 };
 return Object.assign(handler,{hasChallenge(request){clean(now());return challenges.has(getChallenge(request,challengeName))},
  challengeFlow(request){clean(now());return challenges.get(getChallenge(request,challengeName))?.flow}});
}
