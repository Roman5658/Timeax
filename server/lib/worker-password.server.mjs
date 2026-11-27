import {ISSUER} from './provider-adapters.mjs';
import {normalizePublicEmail,validNewPassword} from './public-email-provider.mjs';
import {readBody} from './session-router.mjs';

export const WORKER_PASSWORD_PATH='/api/timeax/auth/public/worker-password';
const reply=(status,body)=>Response.json(body,{status,headers:{
 'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
}});
const exact=(body)=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&Object.hasOwn(body,'password');

export function createWorkerPasswordHandler({origin,provider,resolveSession,eligible,getProof,now=Date.now}){
 return async request=>{
  try{
   const url=new URL(request.url),write=request.method==='POST',from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if(url.origin!==origin||url.pathname!==WORKER_PASSWORD_PATH||url.search||url.hash||request.signal.aborted||
    (write?from!==origin:from!==null&&from!==origin)||site!==null&&site!=='same-origin')return reply(403,{error:'not-permitted'});
   if(!['GET','POST'].includes(request.method))return reply(405,{error:'not-allowed'});
   const session=await resolveSession(request);
   const active=async()=>session?.state==='verified'&&session.issuer===ISSUER&&session.emailConfirmed===true&&
    session.isAnonymous===false&&typeof session.subject==='string'&&normalizePublicEmail(session.email)===session.email&&
    !request.signal.aborted&&await session.isActive()===true;
   if(!await active())return reply(401,{error:'valid-session-required'});
   if(await eligible(session)!==true)return reply(403,{error:'worker-password-not-available'});
   if(!await active())return reply(401,{error:'valid-session-required'});
   const proof=getProof(request,session);
   const fresh=()=>proof?.expiresAt>now()&&proof?.credential?.issuer===session.issuer&&
    proof.credential.subject===session.subject&&proof.credential.email===session.email&&
    proof.credential.emailConfirmed===true&&proof.credential.isAnonymous===false&&getProof(request,session)===proof;
   if(!write)return reply(200,{state:fresh()?(proof.busy?'saving':proof.used?'reauthentication-required':'ready'):'reauthentication-required'});
   if(!fresh()||proof.used||proof.busy)return reply(409,{error:'reauthentication-required'});
   let body;
   try{body=JSON.parse(await readBody(request,2048))}catch{return reply(400,{error:'invalid-request'})}
   if(!exact(body))return reply(400,{error:'invalid-request'});
   if(!validNewPassword(body.password))return reply(400,{error:'invalid-password'});
   if(!await active()||!fresh()||proof.used||proof.busy)return reply(409,{error:'reauthentication-required'});
   proof.busy=true;
   try{
    // This proof has exactly one provider write attempt, even if the provider times out.
    proof.used=true;
    if(await provider.setPassword(proof.credential,body.password)!==true)return reply(409,{error:'password-not-set'});
    return reply(200,{state:'saved'});
   }finally{proof.busy=false}
  }catch{return reply(503,{error:'service-unavailable'})}
 };
}

