import {ISSUER} from './provider-adapters.mjs';
import {readBody} from './session-router.mjs';

export const NFC_SHIFT_ENDPOINTS=Object.freeze({
 prepare:'/api/nfc/shift/prepare',proof:'/api/nfc/shift/proof',record:'/api/nfc/shift/record',
});
const forbidden=/^(?:authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/;
const endpoints=new Map(Object.entries(NFC_SHIFT_ENDPOINTS).map(([name,path])=>[path,name]));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const action=v=>v==='start'||v==='end';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fresh=(v,now,max)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)
 &&Date.parse(v)>now&&Date.parse(v)<=now+max;
const reply=(status,body,headers={})=>Response.json(body,{status,headers:{
 'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie',...headers,
}});

// Detached composition point. The server-owned rollout flag is NOT a client
// opt-in. Use createNfcShiftGate with a live verifier and durable store only.
// scopeForWorker({issuer,subject}) resolves exactly one effective stationary
// assignment and active reader on the server; ambiguous results fail closed.
// All store transactions re-check ongoing session/assignment authority.
export function createStationaryNfcHttpHandler({origin,enabled=false,gate,resolveSession,scopeForWorker,now=Date.now}){
 const base=new URL(origin);
 if(base.protocol!=='https:'||base.origin!==origin||typeof enabled!=='boolean'||typeof now!=='function')throw Error('Invalid NFC HTTP configuration');
 if(enabled&&(!['begin','authorize','record'].every(k=>typeof gate?.[k]==='function')||
  typeof resolveSession!=='function'||typeof scopeForWorker!=='function'))throw Error('NFC server dependencies are required');
 return async request=>{
  try{
   const url=new URL(request.url),operation=endpoints.get(url.pathname);
   if(url.origin!==origin||url.href!==origin+url.pathname||!operation)return reply(404,{error:'unavailable'});
   if(request.method!=='POST')return reply(405,{error:'unavailable'},{Allow:'POST'});
   const originHeader=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if(originHeader!==origin||site!==null&&site!=='same-origin'||[...request.headers.keys()].some(k=>forbidden.test(k)))return reply(403,{error:'denied'});
   if(!enabled)return reply(503,{error:'not-enabled'});
   if(request.signal.aborted)return reply(400,{error:'invalid'});
   const declared=request.headers.get('content-length');
   if(declared!==null&&(!/^[0-9]{1,5}$/.test(declared)||Number(declared)>4608))return reply(400,{error:'invalid'});
   let input;
   try{input=JSON.parse(await readBody(request,4608))}catch{return reply(400,{error:'invalid'})}
   if(operation==='prepare'&&!exact(input,[])||
      operation==='proof'&&(!exact(input,['challenge','deviceProof'])||!opaque(input.challenge)||
       typeof input.deviceProof!=='string'||! /^[A-Za-z0-9_-]{16,4096}$/.test(input.deviceProof))||
      operation==='record'&&(!exact(input,['token','action'])||!opaque(input.token)||!action(input.action)))return reply(400,{error:'invalid'});

   const session=await resolveSession(request);
   if(session?.state==='unavailable')return reply(503,{error:'unavailable'});
   const active=async()=>session?.state==='verified'&&session.issuer===ISSUER&&session.emailConfirmed===true&&
    session.isAnonymous===false&&typeof session.isActive==='function'&&Number.isSafeInteger(session.expiresAt)&&
    session.expiresAt>now()&&uuid(session.subject)&&/^[0-9a-f]{64}$/.test(session.sessionKey??'')&&await session.isActive()===true;
   if(!await active())return reply(401,{error:'sign-in'});
   const assignment=await scopeForWorker({issuer:session.issuer,subject:session.subject});
   if(!exact(assignment,['mode','agencyId','worksiteId','readerId','membershipId'])||
     assignment.mode!=='nfc_stationary'||![assignment.agencyId,assignment.worksiteId,assignment.readerId,assignment.membershipId].every(uuid))
    return reply(403,{error:'denied'});
   if(!await active())return reply(401,{error:'sign-in'});
   const scope=Object.freeze({...assignment,sessionBinding:Buffer.from(session.sessionKey,'hex').toString('base64url')});
   if(request.signal.aborted)return reply(400,{error:'invalid'});

   if(operation==='prepare'){
    const result=await gate.begin(scope);
    return opaque(result?.challenge)&&fresh(result.expiresAt,now(),30000)
     ?reply(200,{challenge:result.challenge,expiresAt:result.expiresAt}):reply(409,{error:'fresh-tap-required'});
   }
   if(operation==='proof'){
    const result=await gate.authorize(scope,input.challenge,input.deviceProof);
    return opaque(result?.token)&&action(result.action)&&fresh(result.expiresAt,now(),15000)
     ?reply(200,{token:result.token,action:result.action,expiresAt:result.expiresAt}):reply(409,{error:'fresh-tap-required'});
   }
   const result=await gate.record(scope,input.token,input.action);
   const state=input.action==='start'?'started':'ended';
   return result?.state===state?reply(200,{state}):reply(409,{error:'fresh-tap-required'});
  }catch{return reply(503,{error:'unavailable'})}
 };
}
